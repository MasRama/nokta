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
  src/app/          composition: start the features, serve them, own the bus name
  src/features/     media, lyrics, settings, devices
  src/shared/       paths, monotonic clock, hashing, D-Bus helpers
  tests/            integration tests on a private bus, contract test
extension/          GNOME Shell extension nokta@nokta.io
  src/extension.ts  composition: shared clients and hooks, one notch per monitor
  src/monitor-notch.ts  composition: one monitor's notch, its views and timers
  src/features/     media, lyrics, settings, osd, devices
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
  current track). `media`, `settings`, `osd` and `devices` depend on no
  other feature; `extension.ts` shows device alerts through the OSD row.
- `osd` (volume, brightness and Caps Lock in the notch) exists only in the
  extension: its sources are GNOME Shell's own OSD calls and the keymap, so
  the daemon only publishes its settings.
- `shared/` holds infrastructure that knows nothing about music or lyrics.
  Feature logic never goes there.
- A feature has the same name on both sides, for example
  `core/src/features/media` and `extension/src/features/media`.
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
  that most recently paused, else none. Because MPRIS does not signal
  position changes, it publishes a position snapshot (position, monotonic
  timestamp, rate) and the extension extrapolates from it.
- **lyrics** looks up synced lyrics on LRCLIB when the track changes, parses
  the LRC text and caches the result per track. "Not found" is cached for 7
  days, errors are not cached.
- **devices** follows UPower and BlueZ on the system bus and emits an
  `Alert` signal when a Bluetooth audio device connects or disconnects, the
  charger is plugged or unplugged, the battery gets low (20 %) or critical
  (10 %), or it is fully charged. The rules are pure (`rules.rs`); the state
  found at startup raises no alert. Without a system bus, UPower or BlueZ
  the daemon runs as before.
- **settings** reads `$XDG_CONFIG_HOME/nokta/config.toml`, writes a commented
  default on first run, watches the file and republishes on change. A broken
  file never stops the daemon: it logs the error with its location and keeps
  the last valid config.

## The D-Bus contract (v1)

Bus name `io.nokta.Nokta`. Every interface name ends in its version. A
breaking change adds `...2` next to `...1` and never changes `...1`. The XML
files in `contracts/` are the full definition; this is the overview.

| Interface | Path | Members |
|---|---|---|
| `io.nokta.Nokta1` | `/io/nokta/Nokta` | `ApiVersion` (`u`, `1`), `DaemonVersion` (`s`) |
| `io.nokta.Media1` | `/io/nokta/Media` | `Available`, `PlayerName`, `PlaybackStatus`, `Title`, `Artists`, `Album`, `LengthUs`, `ArtPath`, `AccentColor`, `PositionUs`, `PositionTimestampUs`, `Rate`, `CanPlayPause`, `CanGoNext`, `CanGoPrevious`, `CanSeek`; `PlayPause()`, `Next()`, `Previous()`, `SetPosition(x)`, `RefreshPosition()` |
| `io.nokta.Lyrics1` | `/io/nokta/Lyrics` | `Status` (`s`), `Lines` (`a(xs)`, start in µs and text) |
| `io.nokta.Settings1` | `/io/nokta/Settings` | `Appearance` (`a{sv}`), `Behavior` (`a{sv}`) |
| `io.nokta.Devices1` | `/io/nokta/Devices` | signal `Alert(kind s, name s, percentage i)` |

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
  equalizer while collapsed and playing, and a 250 ms tick plus one exact
  lyric timeout while expanded and playing. Nothing runs while paused.
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
| Config | `serde` and `toml`, file watching with `notify` |
| Images | `image` (accent color from the cover) |
| Logging | `tracing` to stderr, read by journald |
| Extension language | TypeScript compiled by `tsc` to readable ES modules, no bundler or minifier |
| Extension types | `@girs/*` packages for GNOME 46 |
| Supported shell | GNOME Shell 46 only |
| License | GPL-3.0-or-later |

A GNOME version is added to `shell-version` in `metadata.json` only after it
has been tested on that version.
