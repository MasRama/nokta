# Architecture

This file is the authority on how Nokta is built. When code and this file
disagree, one of them is wrong: fix the code, or change this file in the same
pull request. The original design and its reasoning are in
[docs/specs/2026-10-27-nokta-v0.1-design.md](docs/specs/2026-10-27-nokta-v0.1-design.md).

## Two processes, one contract

```
Media players ──MPRIS (session D-Bus)──▶ noktad (Rust daemon)
                                            │  io.nokta.* interfaces
                                            ▼
                                   GNOME Shell extension (TypeScript → JS)
                                            │
                                            ▼
                                     the notch on screen
```

- **`noktad`** owns all logic and all I/O: following players, caching cover
  art, fetching and caching lyrics, reading the config. It is the part that
  will be reused on other desktops and operating systems.
- **The extension** only draws and animates. It never touches the network or
  the disk, and never does work that could block GNOME Shell's main loop: a
  slow extension makes the whole desktop stutter.
- **The contract** is a set of versioned D-Bus interfaces in `contracts/`.
  Both sides are checked against those files in CI.

A separate daemon instead of doing everything in the extension: it can be
reused elsewhere, a crash cannot take GNOME Shell down, and
extensions.gnome.org does not allow binaries or heavy work inside an
extension. A normal app window cannot do the job either: on GNOME Wayland a
window cannot place itself or stay on top, and GNOME has no layer-shell
protocol. Only an extension can draw in the shell's top layer.

## Repository layout

The code is organized by feature, not by layer: one folder per feature, a
small public boundary, private internals, and a thin composition layer.

```
contracts/          D-Bus interface XML, the single source of truth
core/               crate nokta-core, binary noktad
  src/app/          composition: start the features; on Linux serve them and own the bus name
  src/features/     media, lyrics, settings, devices, timer
  src/shared/       paths, monotonic clock, hashing, D-Bus helpers
  tests/            integration tests on a private bus, contract test
extension/          GNOME Shell extension nokta@nokta.io
  src/extension.ts  composition: shared clients and hooks, one notch per monitor
  src/monitor-notch.ts  composition: one monitor's notch, its views and timers
  src/prefs.ts      the settings window (GTK 4 and libadwaita), with src/prefs/
  src/features/     media, lyrics, settings, osd, devices, timer
  src/shared/       notch shape, animation, clock, top bar, D-Bus helpers
  scripts/          contract code generation and checks, packing
  tests/            Node tests for the pure logic modules
packaging/          systemd user unit, D-Bus activation file, install scripts
tools/devshell/     headless GNOME Shell for checking the UI
docs/               design spec, plans, manual test checklist
```

### Feature rules

- A feature exposes only what its `mod.rs` (Rust) or `index.ts` (TypeScript)
  exports. Other code imports the feature, never its files.
- Feature dependencies are acyclic. `lyrics` depends on `media` (it needs the
  current track). `media`, `settings`, `osd`, `devices` and `timer` depend
  on no other feature; `extension.ts` shows device and timer alerts through
  the OSD row, and `monitor-notch.ts` puts the timer where the clock or the
  equalizer would be.
- `osd` (volume, brightness and Caps Lock in the notch) exists only in the
  extension: its sources are GNOME Shell's own OSD calls and the keymap, so
  the daemon only publishes its settings.
- `shared/` holds infrastructure that knows nothing about music or lyrics.
  Feature logic never goes there.
- A feature has the same name on both sides, for example
  `core/src/features/media` and `extension/src/features/media`.
- The settings window (`prefs.ts`, `prefs/`) runs in GNOME's own preferences
  process, not in the shell. The shell side never imports it, and it never
  imports shell-only modules (`St`, `Clutter`, `Main`). Its rows come from
  `features/settings/logic/schema.ts`, one line per setting.
- In the extension, decisions live in `logic/` folders: plain TypeScript with
  no `gi://` imports, tested with Node. The files around them turn those
  decisions into actors.

## The daemon

- Runs as the systemd user service `nokta.service` and is D-Bus activatable:
  the first call to `io.nokta.Nokta` starts it. A second instance exits
  straight away.
- Event-driven only. It waits on D-Bus signals, file-watch events and HTTP
  responses, and has no polling loops. It uses no CPU while nothing plays.
- **media** follows every `org.mpris.MediaPlayer2.*` player and publishes one
  active player: the one that most recently started playing, else the one
  that most recently paused, else none. A player the user picks
  (`SelectPlayer`) stays active until another one starts playing or it
  stops. Because MPRIS does not signal
  position changes, it publishes a position snapshot (position, monotonic
  timestamp, rate) and the extension extrapolates from it.
- **lyrics** looks up synced lyrics when the track changes: the user's own
  `.lrc` file (next to a local song, or `Artist - Title.lrc` in the lyrics
  folder), then the cache, then LRCLIB. `clean.rs` turns browser and YouTube
  titles into up to three candidates, and a search result counts only when
  its title and artist match. LRCLIB results are cached per track; "not
  found" for 7 days, errors not at all.
- **devices** follows UPower and BlueZ on the system bus and emits an
  `Alert` signal when a Bluetooth audio device connects or disconnects, the
  charger is plugged or unplugged, the battery gets low (20 %) or critical
  (10 %), or it is fully charged. The rules are pure (`rules.rs`); the state
  found at startup raises no alert. Without a system bus, UPower or BlueZ
  the daemon runs as before.
- **timer** runs the focus timer: focus, then a break of its own, then
  idle. A pure `Timer` takes `now` in every method; the task around it
  sleeps until the deadline and emits `Finished`. Lengths come from the
  `[timer]` table when a phase starts. The `Timer` also counts finished
  focus sessions and makes every few breaks the long one. It lives in the
  daemon because GNOME disables extensions on the lock screen. The
  extension does the GNOME-only parts of focus mode: it turns notification
  banners off during focus (and back on), and binds the shortcut through
  its one GSettings key, which it copies from `config.toml`.
- **settings** reads `config.toml` (`$XDG_CONFIG_HOME/nokta/` on Linux,
  `~/Library/Application Support/nokta/` on macOS, `%APPDATA%\nokta\` on
  Windows), writes a commented
  default on first run, watches the file and republishes on change. A broken
  file never stops the daemon: it logs the error with its location and keeps
  the last valid config. `Set` from the settings window checks the new value
  with the same validation, edits the file with `toml_edit` (comments kept)
  and writes it atomically; the watcher then republishes it.

### Portable core and Linux adapters

The daemon is meant to run on other systems, so D-Bus stays at the edge.
Feature models, rules and services use plain Rust types and channels; only
the Linux adapters touch D-Bus:

- each feature's `dbus.rs`, which serves it;
- the system sources: MPRIS in `media` (`mpris`, `watcher`, `control`) and
  UPower and BlueZ in `devices` (`upower`, `bluez`, `watcher`);
- `app/dbus.rs`, which starts those sources, serves everything and owns the
  bus name.

Those modules are declared with `#[cfg(target_os = "linux")]`, and `zbus`
is a Linux-only dependency. `app::Services` starts the rest (settings,
lyrics, timer) on any system. CI builds and tests the daemon on macOS and
Windows, where `noktad` says it has no frontend yet. A new system adds its
own sources and transport next to the Linux ones; nothing in a feature's
model changes.

## The D-Bus contract (v1)

Bus name `io.nokta.Nokta`. Every interface name ends in its version. A
breaking change adds `...2` next to `...1` and never changes `...1`. The XML
files in `contracts/` are the full definition; this is the overview.

| Interface | Path | Members |
|---|---|---|
| `io.nokta.Nokta1` | `/io/nokta/Nokta` | `ApiVersion` (`u`, `1`), `DaemonVersion` (`s`) |
| `io.nokta.Media1` | `/io/nokta/Media` | `Available`, `PlayerId`, `PlayerName`, `Players`, `PlaybackStatus`, `Title`, `Artists`, `Album`, `LengthUs`, `ArtPath`, `AccentColor`, `PositionUs`, `PositionTimestampUs`, `Rate`, `CanPlayPause`, `CanGoNext`, `CanGoPrevious`, `CanSeek`; `PlayPause()`, `Next()`, `Previous()`, `SetPosition(x)`, `RefreshPosition()`, `SelectPlayer(s)` |
| `io.nokta.Lyrics1` | `/io/nokta/Lyrics` | `Status` (`s`), `Lines` (`a(xs)`, start in µs and text) |
| `io.nokta.Settings1` | `/io/nokta/Settings` | `Appearance`, `Behavior`, `Lyrics`, `Timer` (each `a{sv}`); `Set(table s, key s, value v)`, `Reset()` |
| `io.nokta.Devices1` | `/io/nokta/Devices` | signal `Alert(kind s, name s, percentage i)` |
| `io.nokta.Timer1` | `/io/nokta/Timer` | `State`, `Phase`, `DurationUs`, `RemainingUs`, `TimestampUs`, `Sessions`, `LongBreak`; `Start(phase s)`, `Pause()`, `Resume()`, `Stop()`; signal `Finished(phase s)` |

Every property emits `PropertiesChanged`. Changes that belong together, such
as a new track, go out in one signal so the UI never shows a new title with
an old cover.

How both sides stay honest:

- The daemon implements the interfaces with `zbus`. `core/tests/contract.rs`
  introspects the running daemon and compares every interface with the XML.
- The extension builds its proxies from the same XML
  (`scripts/gen-contracts.mjs`), and `scripts/check-contracts.mjs` compares
  the hand-written types in `src/shared/contracts.ts` with it.

## The extension

- The notch is one actor in the shell's top chrome, centered on the primary
  monitor and touching the top edge. It hides when an app goes fullscreen.
  Its shape is a body with rounded bottom corners plus two Cairo-drawn "ears"
  that curve into the top edge.
- States: **idle** (a clock), **collapsed** (small cover and equalizer bars)
  and **expanded** on hover (cover, title, artists, lyric line, seek bar,
  controls). A pure state machine (`shared/logic/machine.ts`) decides when to
  open and close.
- Animations use Clutter's `ease()`, so they run in the compositor and turn
  instant when GNOME animations are off.
- Timers are kept to a minimum: a minute-aligned clock while idle, the
  equalizer while collapsed and playing, a 250 ms tick plus one exact lyric
  timeout while expanded and playing, and one timeout per second while a
  focus timer runs. Nothing runs while paused.
- `disable()` destroys every actor, disconnects every signal, removes every
  main-loop source and puts the clock back.

## Locked stack

Changing anything in this table needs an issue and agreement first.

| Area | Choice |
|---|---|
| Daemon language | Rust, stable, edition 2021 |
| Async runtime | `tokio` |
| D-Bus | `zbus` |
| HTTP | `reqwest` with `rustls` |
| Config | `serde` and `toml`, `toml_edit` for changes from the settings window, file watching with `notify` |
| Images | `image` (accent color from the cover) |
| Logging | `tracing` to stderr, read by journald |
| Extension language | TypeScript compiled by `tsc` to readable ES modules, no bundler or minifier |
| Extension types | `@girs/*` packages for GNOME 46, the oldest supported |
| Supported shell | GNOME Shell 46 to 51 |
| License | GPL-3.0-or-later |

A GNOME version is added to `shell-version` in `metadata.json` only after the
smoke test passes on it in CI (`.github/workflows/gnome.yml`).

Where GNOME versions differ, `extension/src/shared/compat.ts` and the OSD
hook check for the feature (a property or a method), never the version
number. Code is written against the GNOME 46 typings; anything newer goes
through such a check.
