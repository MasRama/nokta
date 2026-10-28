# Architecture

This file is the authority on how Nokta is built. When code and this file
disagree, one of them is wrong: fix the code, or change this file in the same
pull request.

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
  slow extension makes the whole desktop stutter. Its one other process is
  the file shelf's helper window (see [The extension](#the-extension)).
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
core/               crate nokta-core, binaries noktad and nokta
  src/app/          composition: start the features; on Linux serve them and own the bus name
  src/cli/          the `nokta` command: arguments, and on Linux the Activities1 client
  src/features/     media, lyrics, settings, devices, timer, activities, weather,
                    shelf, clipboard
  src/shared/       paths, monotonic clock, hashing, atomic file writes, picture
                    thumbnails, D-Bus helpers
  tests/            integration tests on a private bus, contract test
extension/          GNOME Shell extension nokta@nokta.io
  src/extension.ts  composition: shared clients and hooks, one notch per monitor
  src/monitor-notch.ts  composition: one monitor's notch, its views and timers
  src/prefs.ts      the settings window (GTK 4 and libadwaita), with src/prefs/
  src/features/     media, lyrics, settings, osd, devices, timer, privacy,
                    notifications, panel, activities, weather, calendar, shelf,
                    clipboard
  src/shelf-helper/ the shelf's helper window, a GTK 4 program run with gjs
  src/shared/       notch shape, springs and layout, clock, top bar, keybindings,
                    keyboard focus, D-Bus helpers, icons, dim levels
  icons/            Nokta's own symbolic icons
  scripts/          contract code generation and checks, packing
  tests/            Node tests for the pure logic modules
packaging/          systemd user unit, D-Bus activation file, install scripts
tools/devshell/     headless GNOME Shell for checking the UI
docs/               manual test checklist, screenshots
```

### Feature rules

- A feature exposes only what its `mod.rs` (Rust) or `index.ts` (TypeScript)
  exports. Other code imports the feature, never its files.
- Feature dependencies are acyclic. `lyrics` depends on `media` (it needs the
  current track). `media`, `settings`, `osd`, `devices`, `timer`, `privacy`,
  `notifications`, `panel`, `activities`, `weather`, `calendar`, `shelf` and `clipboard` depend on no other feature;
  `extension.ts` shows device, timer and activity alerts through the OSD
  row. The closed notch has one spot for extra information, where the clock
  or the equalizer would be: `shared/logic/indicator.ts` picks a screen
  recording, else a call, else the focus timer, else a countdown,
  stopwatch or alarm, else the newest live activity, else the shelf, and
  `monitor-notch.ts` puts it there. `shared/logic/progress-line.ts` picks
  what the line along the closed notch's bottom edge shows: that spot's
  progress, else the song beside its cover.
  `monitor-notch.ts` also puts the shelf's row in the panel and in the open
  player, since `panel` cannot import `shelf`. In the same way it opens the
  clipboard's list, or the timer's presets, as a page over home
  (`panel/page.ts` draws the header with the back arrow) when home's
  `Clipboard` or `Timer` tile is clicked. While the
  clipboard's search field is open, `monitor-notch.ts` holds the keyboard
  with `Main.pushModal` on the notch, keeps it open as if the pointer were
  on it, and lets go on Enter, Escape, a click outside or the notch
  closing. It is the same grab the open shortcut takes (see
  [The extension](#the-extension)): one `pushModal` while either wants it.
  `panel` is home, the open notch's other page (the only one while nothing
  plays; the player's grid button opens it, its music button goes back,
  and closing the notch returns to the player). It only draws its rows (the
  date and weather, live activities, the quick toggles and the tiles) from
  plain data, and grows to fit them (`panel/logic/height.ts`). The
  weekday sits dimmed over a large date, the weather across from them; the
  event, call, recording, clock and activity rows each start with an icon
  chip, a rounded square in the row's tone at 20 % (`toneChip`);
  `extension.ts` fills them from `weather`, `calendar`, `activities`,
  `notifications`, `timer` and GNOME's settings, and asks `weather` to
  refresh when home opens. The toggles change GNOME's settings only on a
  click: Do Not Disturb is `show-banners`, set through the timer's
  `QuietBanners` so a focus session never undoes it; Dark Style is
  `color-scheme`; Night Light is gnome-settings-daemon's
  `night-light-enabled`, offered only when its schema is installed;
  Caffeine holds an idle inhibitor of GNOME's session
  manager (`panel/logic/caffeine.ts`, released in `disable()`). Which
  toggles and tiles show, and in which order, is `[home]` of the config
  (`panel/logic/layout.ts`); the settings window edits these lists with
  switches and up and down buttons (`settings/logic/order.ts`). The
  notch's right-click menu (`panel/menu.ts`) is a GNOME popup menu.
- `osd` (volume, brightness, Caps Lock, Num Lock and the keyboard layout
  in the notch) exists only in the extension: its sources are GNOME Shell's
  own OSD calls, the keymap and its input source manager, so
  the daemon only publishes its settings. `privacy` (the camera,
  microphone and screen dots, and calls) is the same: it follows the
  indicators GNOME Shell already shows in the top bar, and for a call reads
  the recording app and the microphone's mute from GNOME's own mixer. A
  screen recording is followed and stopped through GNOME's own screenshot
  UI (`Main.screenshotUI`). `notifications` too: it wraps
  GNOME's `MessageTray._showNotification`, so the notch only gets the
  banners GNOME has already decided to show. Its buttons come from the
  notification's `actions` (each a `label` and `activate()`, GNOME 46 and
  later), checked to be an array of labels; a new one from the same
  `source` object stacks on the one that shows (`logic/stack.ts`). There is
  no inline reply: neither the freedesktop spec nor GNOME Shell has one. A
  banner from GNOME's
  screenshot source with an image becomes a screenshot preview; its file
  comes from `Main.screenshotUI`'s `screenshot-taken` signal. `calendar` reads the events
  the date menu already loads (`dateMenu._eventSource`, found with a
  feature check) and never asks for a time range itself, since the
  calendar server keeps one range for all its clients. One exact timeout
  waits for the next reminder or start (`calendar/alarms.ts`) and is set
  again when the events or settings change.
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
  timestamp, rate) and the extension extrapolates from it. The sound output
  switcher lives in the extension's `media` and only uses GNOME's own mixer
  (the one Quick Settings uses); the daemon is not involved.
- **lyrics** looks up synced lyrics when the track changes: the user's own
  `.lrc` file (next to a local song, or `Artist - Title.lrc` in the lyrics
  folder), then the cache, then LRCLIB. `clean.rs` turns browser and YouTube
  titles into up to three candidates, and a search result counts only when
  its title and artist match. LRCLIB results are cached per track; "not
  found" for 7 days, errors not at all. The user's timing per track
  (`SetOffset`, from the lyrics view) is kept in `lyrics-offsets.toml` next
  to the lyrics folder (`$XDG_DATA_HOME/nokta/`, `Application Support` on
  macOS, `%APPDATA%` on Windows), keyed by a hash of the track that does
  not change with the cache's lookup version, written atomically
  (`shared/fs.rs`); 0 removes the entry. The service publishes `Lines`
  already shifted by it (`offsets.rs`: start − offset, not below 0) on top
  of a file's own `[offset:]`, so the extension never shifts anything.
  `SetOffset` stores the offset for the current track whatever its status,
  so it also applies to lyrics still loading, and fails with no track.
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
  its GSettings key `focus-shortcut`, which it copies from `config.toml`
  (`shared/keybinding.ts`).
  Beside it, a pure `Clocks` (`clocks.rs`) keeps up to six countdowns,
  stopwatches and alarms. They take the wall clock rather than the
  monotonic one, so time spent suspended counts; the task sleeps until the
  next one is due, and logind's `PrepareForSleep(false)` on the system bus
  wakes it after a resume. `nokta alarm HH:MM` turns the local time into a
  Unix time in the CLI (`cli/local_time.rs`, libc's `mktime`).
- **activities** keeps the live activities that apps and scripts report
  (`Set`, `End`): at most 8, newest first. A pure `Activities` takes `now`;
  the task around it sleeps until the oldest one goes stale
  (`[activities] stale_minutes`) and ends it as failed. Every end emits
  `Ended`. The `nokta` command (`src/cli/`) is a thin client of it:
  `nokta settings` (it runs `gnome-extensions prefs`),
  `nokta activity set|end` and `nokta run -- CMD`, which shows the command
  while it runs and passes its exit code through.
- **weather** reads the current weather at `[weather] location` from
  Open-Meteo. The location is coordinates (`-6.2,106.8`) or a place name,
  which the geocoding API turns into coordinates once. `model.rs` is pure:
  WMO weather codes to conditions, and when a reading is stale (30 minutes,
  5 after a failure). The service asks on start, when the location or units
  change, and on `Refresh()` once stale, one request at a time. A failed
  request keeps the last reading. With no location it sends nothing.
- **shelf** keeps the files dropped on the notch (`Add`, `Remove`,
  `Clear`): only `file://` paths that exist, each once, at most 30 (the
  oldest goes). `model.rs` is pure; the service watches the folders that
  hold them and lets a file go once it is moved or deleted. It keeps paths,
  never copies files, and starts empty. `thumbnails.rs` finds each item's
  picture off the async runtime: the thumbnail Files made
  (`$XDG_CACHE_HOME/thumbnails/{large,normal}/md5(uri).png`) when it is not
  older than the file, else a 128 px PNG of its own for a PNG, JPEG or WebP
  up to 64 MB, kept in `cache_dir/thumbnails`.
- **clipboard** keeps what was copied, newest first, in memory only: text up
  to 1 MiB or a PNG up to 8 MiB. `model.rs` is pure: a copy of an entry that
  is already there moves it to the top, pinned entries stay when the history
  is full or cleared, and `[clipboard] max_items` counts the others. The
  extension watches the clipboard and hands each copy over (`Add`); it skips
  what a password manager marks with `x-kde-passwordManagerHint` and does
  nothing while the history is paused or off. The service writes a 128 px
  thumbnail of each picture to `clipboard_dir` (`$XDG_RUNTIME_DIR/nokta/clipboard`
  on Linux, mode 0700, emptied at start) and deletes it with its entry.
  Turning the history off forgets every entry, pinned ones too.
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
lyrics, timer, activities, weather, shelf, clipboard) on any system. CI builds and tests the daemon on macOS and
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
| `io.nokta.Media1` | `/io/nokta/Media` | `Available`, `PlayerId`, `PlayerName`, `Players`, `PlaybackStatus`, `Title`, `Artists`, `Album`, `LengthUs`, `ArtPath`, `AccentColor`, `PositionUs`, `PositionTimestampUs`, `Rate`, `CanPlayPause`, `CanGoNext`, `CanGoPrevious`, `CanSeek`, `Shuffle`, `LoopStatus`, `CanShuffle`, `CanLoop`; `PlayPause()`, `Next()`, `Previous()`, `SetPosition(x)`, `RefreshPosition()`, `SelectPlayer(s)`, `SetShuffle(b)`, `SetLoopStatus(s)` |
| `io.nokta.Lyrics1` | `/io/nokta/Lyrics` | `Status` (`s`), `Lines` (`a(xs)`, start in µs and text, already shifted), `OffsetMs` (`x`, positive is earlier, ±30 000); `SetOffset(offset_ms x)` |
| `io.nokta.Settings1` | `/io/nokta/Settings` | `Appearance`, `Behavior`, `Lyrics`, `Timer`, `Notifications`, `Activities`, `Weather`, `Calendar`, `Clipboard` (each `a{sv}`); `Set(table s, key s, value v)`, `Reset()` |
| `io.nokta.Devices1` | `/io/nokta/Devices` | signal `Alert(kind s, name s, percentage i)` |
| `io.nokta.Timer1` | `/io/nokta/Timer` | `State`, `Phase`, `DurationUs`, `RemainingUs`, `TimestampUs`, `Sessions`, `LongBreak`; `Clocks` `a(sssbxxxx)` (id, kind, label, running, duration, value and monotonic timestamp in µs, alarm time in Unix µs); `Start(phase s)`, `Pause()`, `Resume()`, `Stop()`, `AddCountdown(label s, duration_us x) → id s`, `AddStopwatch(label s) → id s`, `AddAlarm(label s, unix_us x) → id s`, `PauseClock(id s)`, `ResumeClock(id s)`, `RemoveClock(id s)`, `ClearClocks()`; signals `Finished(phase s)`, `ClockDone(id s, kind s, label s)` |
| `io.nokta.Activities1` | `/io/nokta/Activities` | `Activities` (`a(ssssdx)`: id, title, detail, icon, progress, start); `Set(id s, title s, detail s, icon s, progress d)`, `End(id s, success b, message s)`; signal `Ended(id s, title s, success b, message s, elapsed_us x)` |
| `io.nokta.Weather1` | `/io/nokta/Weather` | `Status` (`s`), `Place` (`s`), `Temperature`, `High`, `Low` (`d`), `Units` (`s`), `Condition` (`s`), `IsDay` (`b`); `Refresh()` |
| `io.nokta.Shelf1` | `/io/nokta/Shelf` | `Items` (`a(sss)`: uri, name, icon name, oldest first), `Thumbnails` (`a{ss}`: uri to a PNG path, for items with a picture); `Add(uris as)`, `Remove(uri s)`, `Clear()` |
| `io.nokta.Clipboard1` | `/io/nokta/Clipboard` | `Items` (`a(ssssbx)`: id, kind `text` or `image`, preview, thumbnail path, pinned, copied at in Unix µs, newest first), `Paused` (`b`); `Add(kind s, text s, image ay)`, `Get(id s) → (kind s, text s, image ay)`, `Pin(id s, pinned b)`, `Remove(id s)`, `Clear()` (keeps pinned entries), `SetPaused(paused b)` |

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

- The notch is one actor in the shell's top chrome, centered on its
  monitor and touching the top edge. It hides while its monitor shows a
  fullscreen window, and comes up over it only for an alert that
  `[behavior] fullscreen_alerts` lets through (see below).
  Its shape is a body with rounded bottom corners plus two "ears" that curve
  into the top edge, all drawn by one fragment shader (`shared/shape.ts`:
  `Shell.GLSLEffect` up to GNOME 50, `Clutter.ShaderEffect` from 51).
- Colors come from the theme (`[appearance] theme`): `shared/logic/theme.ts`
  turns it, the color settings (used only by `custom`) and the cover's
  color into one palette for the body, the ears and every view, and the
  notch carries a `nokta-theme-<name>` style class for the stylesheet.
- Icons: the notch draws its own symbolic icons (`icons/nokta-<name>-symbolic.svg`,
  fills only, since St recolors fills and not strokes). `shared/icons.ts`
  `iconFor(name)` takes one of Nokta's names (`nokta-focus`) or a GNOME name
  it redraws (`shared/logic/icon-names.ts`) and falls back to the theme's
  icon for anything else (weather, files, apps); icons from GNOME, as an
  OSD's or a notification's, go through `chromeIcon()`. A notification's
  symbolic icon sits on a 36 px square of the accent at 20 %, an app's
  full-color one alone; a clipboard row shows a link for a copied address,
  a picture or text (`entryIcon`).
- Tones: each kind of thing has its own color (`shared/logic/tones.ts`): the
  focus timer tomato, a countdown amber, Do Not Disturb indigo, the
  clipboard teal and so on. A toggle or tile shows its icon in its tone and
  fills with it while on; alerts glow in the tone of what they are about.
  On a light notch a tone used for an icon is darkened until it reads
  (`toneOn`). The privacy colors stay the usual ones: an orange microphone,
  a green camera. The OSD bar takes the text color, not the cover's. A
  device alert draws the battery before its percentage, filled in red,
  amber or green by level (`osd/logic/battery.ts`).
- Text follows one type scale (caption 11, body 13, title 15, the sung
  lyric 17; semibold labels, bold digits). St CSS ignores `opacity`, so
  dimmed text is dimmed from code with the two levels in `shared/dim.ts`.
- States: **idle** (a clock), **collapsed** (small cover and equalizer bars)
  and **expanded** on hover (cover, title, artists, a lyric row, seek bar,
  shuffle, previous, play, next and repeat). The open cover glows in its own
  color (`media/logic/cover.ts`, softer on a light notch) and the equalizer
  bars sit beside the title while the song plays. The lyric row shows the line
  being sung, lit from left to right as it goes, with the next line under
  it (`lyrics/logic/karaoke.ts`); the fill is one linear `ease()` to the end
  of the line, restarted only when the line, the play state or the position
  changes. A click on the row opens seven lines of the synced lyrics around
  the current one (`lyrics/logic/window.ts`) until a click on them, the
  next track or the notch closing. Under them, `−` and `+` call
  `SetOffset` 250 ms at a time and the label between them (`On time`,
  `0.5 s earlier`, `lyrics/logic/offset.ts`) resets it; the shifted lines
  come back from the daemon, and the fill restarts on them. A pure state
  machine (`shared/logic/machine.ts`) decides when to open and close.
- **Opening.** `NotchMachine` opens the notch after the pointer rests on
  it for `open_delay_ms`, or, with `[behavior] open_on = "click"`, on a
  primary click on the closed notch (`click()`; a press on one of its
  buttons stays the button's), and closes it `close_delay_ms` after the
  pointer leaves. `open(true)` opens it held: only `close()` closes it
  then, whatever the pointer or the player does. The open shortcut
  (`[behavior] open_shortcut`, copied to the GSettings key `open-shortcut`
  and bound by `shared/keybinding.ts` in the normal, overview and popup
  action modes) opens the focused monitor's notch held (`routeOsd`, like
  the OSD) and takes the keyboard with `Main.pushModal` in the popup action
  mode, so GNOME's shortcuts for popups keep working and the open shortcut
  itself reaches the notch again to close it. The clipboard's search shares
  that grab. `shared/focus.ts` lets every reactive `St.Button` of the open
  view take the focus and moves it with St's `navigate_focus` (Tab and
  Shift+Tab go round, the arrows by direction, `shared/logic/keyboard.ts`);
  St.Button presses itself on Enter and Space. The first button of the
  view that shows has the focus, also after the view changes or the
  focused button goes away. Escape, the shortcut again, a click outside
  the notch (a `captured-event` on the grab) or the notch closing any other
  way close it and pop the grab; a popup menu over it (the right-click
  menu, the output menu) takes its own grab on top and gives the focus back
  when it closes. Focused buttons get an inset ring from the stylesheet,
  dark on a light palette (`nokta-light`).
- The notch changes size on springs (`shared/logic/spring.ts`): width and
  height step on the same frames of one `Clutter.Timeline`, which runs only
  until both settle, so they move together and a new size mid-way bends the
  motion instead of restarting it. An alert kicks the width spring, so the
  body overshoots by 6 % and springs back; the kick waits until a resize
  reaches its width, or the motion would swallow it. A frame of a resize
  costs no relayout and no restyle: when a resize starts, the actors take
  one size with room for the whole motion (`shared/logic/motion.ts`), and
  each frame only hands the shader the springs' size and clips the body to
  it, between pixels. Once the springs settle the actors take the final
  size, which keeps every view on the same pixel. The springs step by whole
  refresh periods, so uneven frame callbacks do not make the motion uneven.
  Its glow is a second actor with the same shader, under the shape and
  outside the body's clip, a soft shadow in the colour from
  `shared/logic/glow.ts`; it is hidden while faded out. The bottom corners
  round more as the body grows (`shared/logic/shape.ts`). The body lays its
  views out with `shared/layout.ts`, so a view never makes it bigger than
  the spring says; a larger view is clipped, never reflowed. Views fade and
  scale with Clutter's `ease()`. Everything turns instant when GNOME
  animations are off.
- **Over a fullscreen app.** The notch is top chrome without GNOME's
  `trackFullscreen`, so it follows fullscreen itself, the way GNOME's
  layout does: its monitor's `inFullscreen` while the windows show
  (`global.window_group`, hidden in the overview), read again on
  `global.display`'s `in-fullscreen-changed`. Every alert has a kind, and
  `shared/logic/fullscreen.ts` decides (`showsOverFullscreen`) whether it
  shows there: `important` lets through a low or critical battery, a focus
  session or break ending, a countdown or alarm done and a calendar
  reminder; `all` also the other device alerts, activity ends and the OSD.
  Notifications never do, since GNOME holds its banners while an app is
  fullscreen. An alert that passes shows the notch until it ends, then
  hides it again at rest; the pointer does not open it meanwhile. While it
  shows over a fullscreen window, unredirection is off
  (`global.compositor.disable_unredirect()` from GNOME 48,
  `Meta.disable_unredirect_for_display()` before, in `shared/compat.ts`),
  or the window would bypass the compositor and cover it. Each notch holds
  it once at most (`UnredirectHold`) and gives it back when it hides and in
  `destroy()`; mutter counts the calls, so two notches holding it at once
  stay paired too.
- Timers are kept to a minimum: a minute-aligned clock while idle, the
  equalizer while playing and on screen, a 250 ms tick plus one exact lyric
  timeout while expanded and playing, one timeout per second while a
  focus timer or the closed notch's countdown or stopwatch runs (one
  timeout for an alarm's last hour), and one per second while the open
  panel shows a live activity or a clock. Nothing runs while paused.
- Privacy dots follow the `visible` property of GNOME's own camera,
  microphone and screen sharing indicators; no polling, no extra D-Bus.
- **The file shelf.** GNOME Shell cannot take a drop from an app or start a
  drag into one; only a Wayland client can. So `shelf/helper.ts` starts
  `shelf-helper/main.js` with gjs as the shell's own Wayland client
  (`Meta.WaylandClient`): a GTK 4 window that draws nothing, made a dock
  (above every window, not in Alt+Tab or the overview) and kept off every
  monitor. `shelf/coordinator.ts` moves it under the drop area while files
  are dragged to a notch (`MetaDnd` reports the drag) and under the shelf
  row while the pointer is on it, and makes the notch and the top bar let
  the pointer through meanwhile. The window takes the drop and the presses,
  talks to noktad itself, and tells the shell what the pointer does in one
  line per event on its standard output (`shelf/logic/protocol.ts`). It is
  started again if it dies, three times at most. The shell moves it before
  resizing it, since a window off every monitor never draws and so never
  takes a new size.
- `disable()` destroys every actor, disconnects every signal, removes every
  main-loop source, ends the shelf's helper and puts the clock back.

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
