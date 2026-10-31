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
                    calendar, shelf, clipboard, downloads, system, updates
  src/shared/       paths, monotonic clock, hashing, atomic file writes, picture
                    thumbnails, D-Bus helpers
  tests/            integration tests on a private bus, contract test
extension/          GNOME Shell extension nokta@nokta.io
  src/extension.ts  composition: shared clients and hooks, one notch per monitor
  src/monitor-notch.ts  composition: one monitor's notch, its views and timers
  src/indicator-widgets.ts  the closed notch's indicator widgets, a set in idle and one beside the cover
  src/logic/        the composition's decisions: which view shows and its size
  src/prefs.ts      the settings window (GTK 4 and libadwaita), with src/prefs/
  src/features/     media, lyrics, settings, osd, devices, timer, privacy,
                    notifications, panel, activities, weather, calendar, shelf,
                    clipboard, downloads, system, updates, tour
  src/shelf-helper/ the shelf's helper window, a GTK 4 program run with gjs
  src/shared/       notch shape, springs and layout, clock, top bar, keybindings,
                    keyboard focus, D-Bus helpers, icons, dim levels
  icons/            Nokta's own symbolic icons
  po/               translations: the template and one .po per language
  scripts/          contract code generation and checks, translation template, packing
  tests/            Node tests for the pure logic modules
packaging/          systemd user unit, D-Bus activation file, install scripts
tools/devshell/     headless GNOME Shell for checking the UI
desktop/            Nokta for Windows: a Tauri 2 app
  src-tauri/        crate nokta-desktop: the windows, the tray, the commands
  src/              the notch's page (TypeScript, Vite), sharing the extension's logic/
  tests/            Vitest tests of the page's own modules
  scripts/          screenshots of the page in Chrome
tools/windows/      the Windows smoke's screenshot script
docs/               manual test checklist, screenshots
```

### Feature rules

- A feature exposes only what its `mod.rs` (Rust) or `index.ts` (TypeScript)
  exports. Other code imports the feature, never its files.
- Feature dependencies are acyclic. `lyrics` depends on `media` (it needs the
  current track). `media`, `settings`, `osd`, `devices`, `timer`, `privacy`,
  `notifications`, `panel`, `activities`, `weather`, `calendar`, `shelf`, `clipboard`, `downloads` and `system` depend on no other feature;
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
  clipboard's list, the timer's presets, or the settings page, as a page
  over home (`panel/page.ts` draws the header with the back arrow) when
  home's `Clipboard`, `Timer` or `Settings` tile is clicked. The settings
  page (`settings/page.ts`) shows the themes as small notches, switches for
  the cover's color, the progress line and the alert glow, and three motion
  speeds (`settings/logic/quick.ts`); a click shows at once and goes to the
  daemon through `Settings1.Set`, and `All settings` opens the settings
  window, as the right-click menu's `Settings` does. While the
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
  banners GNOME has already decided to show. Both hooks run Nokta's part
  through `orGnome` (`shared/logic/guard.ts`): when it throws, the error is
  logged and GNOME's own banner or popup shows, so a Nokta bug never stalls
  the message queue or loses the volume popup. Its buttons come from the
  notification's `actions` (each a `label` and `activate()`, GNOME 46 and
  later), checked to be an array of labels; a new one from the same
  `source` object stacks on the one that shows (`logic/stack.ts`). There is
  no inline reply: neither the freedesktop spec nor GNOME Shell has one. A
  banner from GNOME's
  screenshot source with an image becomes a screenshot preview; its file
  comes from `Main.screenshotUI`'s `screenshot-taken` signal. `downloads`
  follows the daemon's `Finished` signal and shows the file in the same
  preview (`shared/file-preview.ts`): open it, show it in Files, or keep it
  on the shelf. `system` asks the daemon to sample while its page is open
  (`Watch`, `Unwatch`, counted so one notch or many make one call) and
  shows `MemoryLow` as an urgent alert. `calendar` reads the events
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
  imports shell-only modules (`St`, `Clutter`, `Main`); `prefs-imports.test.ts`
  follows its imports to check. So `features/settings/index.ts` exports no
  actors, and the notch imports the settings page from `settings/page.ts`
  itself. Its rows come from
  `features/settings/logic/schema.ts`, one line per setting. The window
  replaces the content GNOME's dialog gives it with its own: a sidebar of
  pages with Nokta's icons (`prefs/logic/look.ts`), and Appearance opening
  on a drawn preview of the notch with a sample song (`prefs/preview.ts`)
  and the theme gallery (`prefs/themes.ts`), both following each change at
  once. Its stylesheet (`prefs/logic/style.ts`) is added for the whole
  display above the user's own `gtk.css`, with every rule scoped to the
  window's `nokta-prefs` class and literal colors only, so other
  extensions' windows in the same process keep their look and GNOME 46
  (no CSS variables) draws it too.
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
  (the one Quick Settings uses); the daemon is not involved. With
  `[media] real_equalizer` on and a player playing, `capture.rs` runs
  `pw-record` on the default output's monitor (16 kHz mono s16 on stdout,
  `application.id` `io.nokta.Nokta`), `levels.rs` turns each 40 ms into
  four band levels against a peak that decays, and `Media1.Levels` carries
  them (zeros only twice a second while silent). Recording stops 2 s after
  playback or the key, and waits 30 s after `pw-record` fails; without it
  the bars keep their pattern. The extension reads the newest levels on
  each equalizer step, and its privacy dots and call view skip
  `io.nokta.Nokta`'s recording.
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
  Romanizing Korean and Japanese lines (`[lyrics] romanize`) is the
  extension's own, offline: `features/lyrics/logic/romanize.ts`. So are
  the full-screen lyrics (`features/lyrics/fullscreen.ts`): an actor over
  one monitor on top of `Main.uiGroup`, modal through `Main.pushModal`,
  reading the notch's lyrics and position every 100 ms and closing itself
  when the song has no synced lyrics any more. Its seek bar and buttons
  are the player's (`ProgressBar`, `MediaControls` from `features/media`).
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
  `launcher_watch.rs` listens for `com.canonical.Unity.LauncherEntry.Update`
  from any app (what docks read) and feeds the pure `launcher.rs`: an
  activity `app:<desktop id>`, named from its desktop entry
  (`desktop.rs`), once its progress has been visible for 1.5 s, updated at
  most twice a second, ended as done when the bar hides and as stopped
  when the app leaves the bus. `packagekit_watch.rs` follows PackageKit on
  the system bus and feeds the pure `packagekit.rs`: installs, removals,
  updates and system upgrades become `packagekit:<transaction path>`,
  simulations and download-only runs are skipped, and `Finished` ends them
  as done, failed or cancelled. It never starts PackageKit: it asks the bus
  for its owner and calls it by that unique name, and reads all of
  PackageKit's signals from one stream so `Finished` comes before the list
  that drops its transaction. `[activities] auto_progress` turns both off.
- **weather** reads the current weather at `[weather] location` from
  Open-Meteo. The location is coordinates (`-6.2,106.8`) or a place name,
  which the geocoding API turns into coordinates once. `model.rs` is pure:
  WMO weather codes to conditions, and when a reading is stale (30 minutes,
  5 after a failure). The service asks on start, when the location or units
  change, and on `Refresh()` once stale, one request at a time. A failed
  request keeps the last reading. With no location it sends nothing.
- **calendar** finds the meeting link of an event the shell lists
  (`MeetingLink(event_id)`), and the color of its calendar
  (`EventColor(event_id)`). The shell's id names the calendar source, the
  event and its recurrence; `eds.rs` opens that calendar on Evolution Data
  Server and reads the event's iCalendar text. `link.rs` is pure: it
  unfolds and unescapes the text and takes the first `https://` link on a
  meeting service (Meet, Zoom, Teams, Webex, Jitsi, Whereby) from
  `X-GOOGLE-CONFERENCE`, `CONFERENCE`, `URL`, `LOCATION`, then
  `DESCRIPTION`. For the color, `eds.rs` lists EDS's sources
  (`Sources5`, `GetManagedObjects`) and `color.rs`, also pure, reads the
  source's `[Calendar] Color` as `#rrggbb` (Evolution's `#rrggbb` or
  `#rrrrggggbbbb`, GNOME Calendar's `rgb()`). Answers, found or none, are
  kept 10 minutes (links by event, colors by source); EDS missing or slow
  (5 s) gives none and is logged once for each.
  For the Windows app, which has no system calendar, `feeds.rs` reads
  the `[calendar] feeds` (secret iCal addresses, `webcal://` over HTTPS)
  at start, when they change, every 15 minutes and on wake, and publishes
  the events not ended that start in the next 7 days; a feed that fails
  keeps its last events, and only its number and host are logged.
  `ics.rs` (pure) reads the timed events, all-day ones left out: times
  in UTC, a TZID (the time zone database's, else the feed's own
  VTIMEZONE at its standard offset, as for Outlook's Windows names) or the
  computer's zone; `recur.rs` repeats an RRULE at its local time (DAILY
  to YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH; any
  other BY part shows the event once), less EXDATEs and the times a
  RECURRENCE-ID moved or cancelled.
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
- **downloads** watches the download folder (`[downloads] folder`, else
  `XDG_DOWNLOAD_DIR` from `user-dirs.dirs`), not its subfolders, and says
  when a file finished (`Finished`). On Linux a file counts when it is
  renamed into place or closed after writing; elsewhere when it appears or
  changes. `model.rs` is pure: hidden names, names ending in `~` and the
  names browsers use while they download (`.part`, `.crdownload` and so on)
  never count, a file must go untouched for 1.5 s and be larger than zero,
  and the same file is told once a minute at most. A PNG, JPEG or WebP gets
  a 128 px thumbnail in `cache_dir/downloads`, which keeps the 20 newest.
  A missing folder is logged and watched no further.
- **system** samples the CPU, memory, CPU temperature and network every
  2 s, and only while a D-Bus client watches: `Watch` and `Unwatch` count
  per sender, and a sender that leaves the bus stops watching. While nobody
  watches, `Usage` is all zero (temperature NaN). `model.rs` is pure: the
  parsers of `/proc/stat`, `/proc/meminfo`, `/proc/net/dev` and
  `/proc/<pid>/status`, the CPU sensor's choice among the hwmon chips, the
  rates between two readings, the watchers and the 10 minute gap between
  memory alerts. `service.rs` runs on any system with a `Source`; on Linux
  `sample.rs` reads `/proc` and `/sys` and `pressure.rs` blocks a thread in
  `poll()` on a PSI trigger (`/proc/pressure/memory`), which tells it when
  memory runs short. Where the kernel refuses the trigger there is no
  alert. `app/dbus.rs` starts it, since its source is Linux only.
- **updates** asks GitHub's API for the latest release
  (`github.rs`, `/repos/MasRama/nokta/releases/latest`, which leaves out
  drafts and pre-releases) 30 s after start and then every 24 h by the
  wall clock: the task sleeps until the deadline and looks again after
  each resume from suspend (`shared::dbus::resumes`, logind's
  `PrepareForSleep`). `model.rs` is pure: a tag is newer only as three
  plain numbers above the running version, and `check_sum` finds a file's
  SHA-256 in `sha256sum` output. A failed request keeps what was known.
  `[updates] check = false` sends nothing and forgets; `Check()` asks
  anyway. `Install()` (`install.rs`) runs the `nokta` beside the running
  `noktad` as `systemd-run --user --unit=nokta-update -- nokta update
  --yes`, so the installer's restart of `nokta.service` does not stop it.
  `nokta update` (`cli/update.rs`) downloads the tarball and `SHA256SUMS`
  into `cache_dir/update`, refuses a tarball that is not listed or does not
  match, unpacks it with `tar` and runs its `install.sh`, reporting the
  activity `update:nokta` meanwhile. The release job publishes
  `SHA256SUMS` from 0.11 on.
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
  UPower and BlueZ in `devices` (`upower`, `bluez`, `watcher`), the dock
  and PackageKit in `activities` (`launcher_watch`, `packagekit_watch`);
- `app/dbus.rs`, which starts those sources, serves everything and owns the
  bus name.

Those modules are declared with `#[cfg(target_os = "linux")]`, and `zbus`
is a Linux-only dependency. `app::Services` starts the rest (settings,
lyrics, timer, activities, weather, shelf, clipboard, downloads) on any system; `system` has only a Linux source and starts in `app/dbus.rs`. CI builds and tests the daemon on macOS and
Windows, where `noktad` has no frontend; on Windows the app in `desktop/`
is the frontend (see [The Windows app](#the-windows-app)). A new system adds its
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
| `io.nokta.Settings1` | `/io/nokta/Settings` | `Appearance`, `Behavior`, `Lyrics`, `Timer`, `Notifications`, `Activities`, `Weather`, `Calendar`, `Clipboard`, `Downloads`, `System`, `Updates` (each `a{sv}`); `Set(table s, key s, value v)`, `Reset()` |
| `io.nokta.Devices1` | `/io/nokta/Devices` | signal `Alert(kind s, name s, percentage i)` |
| `io.nokta.Timer1` | `/io/nokta/Timer` | `State`, `Phase`, `DurationUs`, `RemainingUs`, `TimestampUs`, `Sessions`, `LongBreak`; `Clocks` `a(sssbxxxx)` (id, kind, label, running, duration, value and monotonic timestamp in µs, alarm time in Unix µs); `Start(phase s)`, `Pause()`, `Resume()`, `Stop()`, `AddCountdown(label s, duration_us x) → id s`, `AddStopwatch(label s) → id s`, `AddAlarm(label s, unix_us x) → id s`, `PauseClock(id s)`, `ResumeClock(id s)`, `RemoveClock(id s)`, `ClearClocks()`; signals `Finished(phase s)`, `ClockDone(id s, kind s, label s)` |
| `io.nokta.Activities1` | `/io/nokta/Activities` | `Activities` (`a(ssssdx)`: id, title, detail, icon, progress, start); `Set(id s, title s, detail s, icon s, progress d)`, `End(id s, success b, message s)`; signal `Ended(id s, title s, success b, message s, elapsed_us x)` |
| `io.nokta.Weather1` | `/io/nokta/Weather` | `Status` (`s`), `Place` (`s`), `Temperature`, `High`, `Low` (`d`), `Units` (`s`), `Condition` (`s`), `IsDay` (`b`); `Refresh()` |
| `io.nokta.Calendar1` | `/io/nokta/Calendar` | `MeetingLink(event_id s) → link s`, `EventColor(event_id s) → color s` (empty when none) |
| `io.nokta.Shelf1` | `/io/nokta/Shelf` | `Items` (`a(sss)`: uri, name, icon name, oldest first), `Thumbnails` (`a{ss}`: uri to a PNG path, for items with a picture); `Add(uris as)`, `Remove(uri s)`, `Clear()` |
| `io.nokta.Clipboard1` | `/io/nokta/Clipboard` | `Items` (`a(ssssbx)`: id, kind `text` or `image`, preview, thumbnail path, pinned, copied at in Unix µs, newest first), `Paused` (`b`); `Add(kind s, text s, image ay)`, `Get(id s) → (kind s, text s, image ay)`, `Pin(id s, pinned b)`, `Remove(id s)`, `Clear()` (keeps pinned entries), `SetPaused(paused b)` |
| `io.nokta.Downloads1` | `/io/nokta/Downloads` | signal `Finished(uri s, name s, icon s, size t, thumbnail s)` (thumbnail is a PNG path, empty for a file that is not a picture) |
| `io.nokta.System1` | `/io/nokta/System` | `Usage (dttddd)`: CPU 0-1, memory used and total bytes, temperature °C (NaN when unknown), download and upload bytes/s, all zero while nobody watches; `Watch()`, `Unwatch()`; signal `MemoryLow(used t, total t, app s)` |
| `io.nokta.Updates1` | `/io/nokta/Updates` | `Latest` (`s`, the newer release's version, empty when none), `ReleaseUrl` (`s`); `Check()`, `Install()` |

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
- Words: every string the user reads goes through `_()` from
  `shared/logic/i18n.ts`, which `enable()` and the settings window connect
  to the extension's gettext (domain `nokta@nokta.io` from `metadata.json`)
  and `disable()` disconnects. Module-level tables mark their strings with
  `N_()` and translate them where they are drawn; numbers go in with
  `format()`, so a translation can reorder them. The daemon's own words
  (PackageKit titles and details) arrive in English and are translated as
  they arrive (`activitiesFrom`); `shared/logic/daemon-strings.ts` lists
  them, and a test keeps it in step with the Rust source. Song titles, app
  names and user text pass through untouched. `scripts/i18n.mjs` writes
  `po/nokta@nokta.io.pot` and, inside `npm run check`, fails while `id.po`
  misses an entry; `pack.sh` compiles the `.po` files into the zip.
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
- **The first-run tour** (`features/tour`). Two seconds after `enable()`,
  while the extension's GSettings key `tour-shown` is false, the session
  opens the primary monitor's notch held on the `tour` view, with the
  keyboard grab of the open shortcut and Next focused, so Enter goes on and
  Escape skips. Its steps are pure (`tour/logic/steps.ts`); the second one
  says how the notch opens (`open_on`, `open_shortcut`). The tour ends with
  Done, Skip, Escape or the notch closing any other way, and the key turns
  true. A fullscreen app that hides the notch makes it wait instead; it
  opens once the monitor is no longer fullscreen. The settings window's
  "Show the tour again" turns the key off, and the session, watching it,
  shows the tour again.
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
  Above the views and inside the body's clip lies the morph layer
  (`shared/morph.ts`): between two views it flies a `Clutter.Clone` of the
  larger of two matching actors (the cover, or an indicator and its row's
  icon in home) from one place to the other, while both real ones are
  hidden. `shared/logic/morph.ts` decides what flies and the clone's
  transform; the places are in stage coordinates, so the body's envelope
  size does not move them.
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

## The Windows app

`desktop/` is Nokta for Windows: one Tauri 2 process that draws the notch in
WebView2 and runs the core's services itself, with no D-Bus.

- `src-tauri/` is the crate `nokta-desktop`. It is a workspace member but
  not a default one, so `cargo test` at the root stays the core's; use
  `-p nokta-desktop`. Tauri and the `windows` crate are Windows-only
  dependencies: elsewhere the binary only says it runs on Windows, and its
  pure modules (`layout.rs`) are tested on every system.
- `src/` is the page, TypeScript built by Vite with no UI framework. It
  imports the extension's pure `logic/` modules through the `@ext` alias
  (`extension/src`), so a decision lives in one place for both; only the
  drawing is new, DOM and SVG where the extension has St actors and a
  shader (`notch/notch.ts` draws the same silhouette, glow and shadow in
  SVG on the same springs). `monitor-notch.ts` ties them together as the
  extension's does.
- The bridge (`src-tauri/src/bridge/`, `src/bridge/`) stands in for D-Bus:
  each interface's properties go to the page under their names in
  `contracts/*.xml` (`bridge_props`, changes on `nokta://props`) and its
  methods are called by name (`bridge_call`). A test holds the properties
  to the contracts. In a browser the page uses an in-memory mock instead.
- `src-tauri/src/win/services.rs` starts `app::Services` on Tauri's async
  runtime and forwards their changes; the log goes to
  `%LOCALAPPDATA%\nokta\nokta.log` (`NOKTA_LOG` sets the level).
- The players come from Windows' media sessions (GSMTC, the ones the
  system's own media flyout shows): `media/gsmtc.rs` in the core follows
  them on a thread of its own and publishes the same `MediaState` the MPRIS
  watcher does, with the cover as bytes kept by `ArtCache::store`; the
  rules that need no Windows API (`media/session.rs`) are tested on every
  system. `Media1` gives the page `PositionTimestampUs` on the wall clock
  (`Date.now() * 1000`), as the page has no monotonic clock to match.
- The bars follow the music the same way, with the same setting and the
  same `levels.rs`: `media/loopback.rs` records the default output with
  WASAPI loopback on a thread of its own instead of `pw-record`, and
  `mix.rs` (tested everywhere) brings Windows' mix to 16 kHz mono. The
  levels reach the page as the `Media1.Levels` signal on `nokta://signal`.
- What GNOME's OSD shows on Linux, the app hears from Windows and sends as
  `Osd1.Show(kind, level, name)`, an interface of the bridge only (no
  D-Bus contract): `volume`, `muted` and `brightness` with a level from 0
  to 1, `caps-lock` and `num-lock` with 1 for on, and `layout` with the
  new layout's name. Device alerts come as `Devices1.Alert`, as on D-Bus.
  The page (`alerts.ts`) turns both into the extension's OSD content,
  icon, glow and motion; Windows has no icon theme, so the page draws the
  battery icons itself.
- The device alerts come from the same rules as on Linux
  (`devices/rules.rs`): `win_power.rs` reads `GetSystemPowerStatus`
  whenever Windows calls back for the power source or the percentage,
  and `win_bluetooth.rs` follows the paired Bluetooth devices with a
  device watcher (connection and class of device). Windows gives no
  Bluetooth battery, so a connect alert goes at once without one.
- The OSD's sources (`win/osd/`) each run on a thread of their own, with
  the rules in `osd.rs` (tested everywhere). A low-level keyboard hook
  notes the volume keys and, for a moment after a lock key or a modifier
  comes up, reads Caps Lock, Num Lock and the foreground window's layout;
  a layout shows only when the same window switches. The default output's
  volume callback (moved with the default output) shows the volume only
  just after a volume key, as Windows' own OSD does. The brightness comes
  from WMI's `WmiMonitorBrightnessEvent`, built-in displays only, and
  shows when it moves by a key's step, not the light sensor's drift.
- The privacy dots and the call come from `Privacy1`, an interface of the
  bridge only. Windows records each app's last use of the camera and the
  microphone under `CapabilityAccessManager\ConsentStore`: a device is in
  use while an entry has started and not stopped (`privacy.rs`, tested
  everywhere). `win/privacy.rs` waits on Windows' change events for both
  keys and on the default microphone's mute, which `ToggleMute` flips.
  Windows has no signal for a shared screen, so that dot never shows. Home's call row names the app
  (Windows gives no icon for it, so its chip is a microphone) and mutes
  or hides the call, as the extension's.
- A fullscreen app hides the notch on its monitor. `win/fullscreen.rs`
  follows Windows' window events (foreground, moved or resized,
  minimized), waits for them to settle and walks the app windows from the
  top: hidden, minimized, cloaked, tool and shell windows and Nokta's own
  do not count. The monitor is covered when its top window, past smaller
  always-on-top ones, reaches every edge without a title bar
  (`fullscreen.rs`, tested everywhere). Each window hears `nokta://fullscreen`
  and asks `notch_fullscreen` once at start; the page hides the notch and
  its click box and lets through what `fullscreen_alerts` allows, as the
  extension does.
- The open shortcut is a hotkey (`RegisterHotKey`) on a thread of its own,
  read from the same `open_shortcut` as GNOME's (`shortcut.rs`, tested
  everywhere) and registered again when it changes. It opens the notch on
  the monitor of the window in front, which takes the focus despite
  `WS_EX_NOACTIVATE`, and tells the page (`nokta://keyboard`). The page
  moves the focus as the extension does (Tab, Shift+Tab, the arrows) and
  closes on Escape, the shortcut again, or the window losing the keyboard;
  `release_keyboard` then gives it back to the window it came from.
- One window per monitor (`notch-<n>`) sits at the monitor's top centre,
  sized for the widest notch and the tallest view with room for the glow
  (`layout.rs`). It is borderless, see-through and topmost, with
  `WS_EX_TOOLWINDOW` (no taskbar button, not in Alt+Tab) and
  `WS_EX_NOACTIVATE`, and a subclass answers `WM_MOUSEACTIVATE` with
  `MA_NOACTIVATE`, so a click never takes the focus from the user's app.
  The whole window draws, so the glow and the shadow reach past the
  notch, and lets clicks through (`WS_EX_TRANSPARENT | WS_EX_LAYERED`).
  The page reports the room the notch takes (`set_hit_region`), the whole
  motion while it moves; a thread follows the pointer and makes the window
  take clicks while the pointer is in that room, telling the page on
  `nokta://pointer`, since the page hears nothing while clicks pass. A
  `SetWinEventHook` on `EVENT_SYSTEM_FOREGROUND` raises the notches again
  whenever another window comes forward.
- The windows follow the monitors (`win/monitors.rs`). The subclass also
  hears `WM_DISPLAYCHANGE` (a monitor plugged in or out, a new resolution
  or arrangement) and `WM_DPICHANGED`; half a second after the last, the
  windows are planned anew (`monitors.rs`, tested everywhere): a window
  stays on a monitor that did not move, the others take the monitors left
  in order, the rest close, and a new monitor gets a new window. Each is
  placed again with its click box. A volume, a key or a device alert goes
  only to the notch on the monitor of the window in front, as the
  extension routes it to the focused monitor; the player's levels go to
  every notch.
- Home shows the weather from `Weather1` beside the date (refreshed as the
  notch opens), the quick toggles and the tiles. The toggles come from
  `Toggles1`, an interface of the bridge only (`win/toggles.rs`): Dark
  Style follows `AppsUseLightTheme` under `Themes\Personalize` through
  `RegNotifyChangeKeyValue`, and setting it writes the apps' and the
  system's value and broadcasts `ImmersiveColorSet`, as the Settings app
  does; it also picks the notch's light theme under `follow_system_style`.
  Caffeine holds `SetThreadExecutionState` on a thread of its own. Windows
  has no public Do Not Disturb or Night Light, so those toggles do not
  show. The notifications and screenshot tiles open Windows' own
  notification centre and snipping overlay through `open_uri`, which
  opens only those and web pages (`links.rs`, tested everywhere); the
  other tiles show as their pages come to Windows.
- The focus timer and the clocks are the core's (`Timer1`), their
  monotonic timestamps put on the wall clock for the page as `Media1`'s.
  `Finished` and `ClockDone` go to the notch on the monitor in use, with a
  sound from Windows' scheme under `[timer] sound` (`win/sound.rs`). The
  window subclass hears `WM_POWERBROADCAST`, so the clocks read the wall
  clock again after sleep, as noktad does on logind's `PrepareForSleep`.
  `[timer] shortcut` is a second hotkey on the shortcut thread that starts
  focus or stops the timer. The page draws them with the extension's
  timer logic: the time left in the clock's place on the closed notch
  (after a call, through `chooseIndicator`), up to three clock rows on
  home, the Focus tile, and the Timer tile's page of presets, a sub-page
  sized with the extension's `subPageHeight`.
- The live activities (`Activities1`) and the update check (`Updates1`)
  are the core's services, as noktad runs them; the start times go on the
  wall clock, and `Ended` goes to the notch on the monitor in use. The
  update check counts the wakes the window subclass hears, so a check
  that came due while asleep runs on waking. Windows has no PackageKit or
  app launcher signals, so no activity starts on its own there.
  The page shows them as the extension does: the newest activity's badge
  in the indicator's spot and on the progress line, up to three activity
  rows on home, and the update row, which opens the release page; it gets
  its Update button with the Windows update install.
- The system counters (`System1`) are the core's service with a Windows
  `Source` (`system/win.rs`): `GetSystemTimes`, `GlobalMemoryStatusEx`,
  and `GetIfTable2`'s hardware adapters that are up, filters and loopback
  left out. Windows gives the CPU's temperature to administrators only, so
  it stays unknown, sent as null since JSON has no NaN. Low memory is
  Windows' own `LowMemoryResourceNotification`; the alert names the
  process with the largest working set. A notch window watches as a D-Bus
  caller does, by its label, and a window that closes stops watching.
  The System tile's page watches while it is open, as the extension's,
  and draws the CPU's last minute, the memory bar, the temperature and
  the network's speed; `MemoryLow` shows the extension's red alert under
  `[system] memory_alert`.
- Downloads are the core's watcher on the Downloads folder, as noktad's,
  where Windows says it is (`win/folders.rs`, the known folder, so a moved
  one is followed); `Finished` goes to the notch on the monitor in use. The page may open a
  file or show it in Explorer (`open_file`) only when the core announced
  it (`files.rs`, tested everywhere), so it can never start a program of
  its own choosing. The page shows it as the extension does, its
  thumbnail or an icon for its kind (drawn by the page, as Windows has no
  icon theme) with Open and Show in Explorer, for as long as a
  notification and longer under the pointer.
- Screenshots are the same watcher on Windows' Screenshots folder
  (`win/screenshots.rs`), where Win+PrtScn and the Snipping Tool save, while
  `[behavior] screenshot_preview` is on. `Screenshots1.Taken`, only on the
  bridge, has `Finished`'s arguments; the page shows it in the download's
  preview titled Screenshot, as GNOME's banner gives way to the extension's
  preview.
- The shelf (`Shelf1`) is the core's service. Files dropped on a notch
  reach it through Tauri's drag-and-drop events (`win/shelf.rs`), and
  only over the notch, since elsewhere the window lets the pointer
  through; `nokta://drop` tells that notch to show its drop view. The page
  may `Add` only files the core announced, like a download. Dragging files
  out is Windows' own shell drag (`SHDoDragDrop` on a shell item array),
  which copies them as Explorer would; once an app took them they leave
  the shelf, as on GNOME. While it runs, a drop back on the notch is
  ignored. The page draws the extension's shelf row in home and under the
  open player (the stack, then the newest files that fit), the count in
  the closed notch, and the drop area; a slot's own pointer events open,
  remove or drag its file, as the GNOME helper window's presses do.
  Keep on shelf in a download's preview adds it.
- The clipboard history (`Clipboard1`) is the core's service. A
  message-only window on its own thread (`win/clipboard.rs`) listens for
  copies (`AddClipboardFormatListener`) and hands each over as the
  extension's watcher does: text first, else a picture (the `PNG` format,
  else a DIB made into a PNG by `src/clipboard.rs`), nothing that asks
  clipboard tools to skip it, and nothing at all while the history is off
  or paused. `Copy(id)`, which only the bridge has, puts an entry back:
  the window owns the clipboard, so it writes the text, or the picture as
  `PNG` and `CF_DIB`. The Clipboard tile opens the extension's page
  (`views/clipboard.ts`); its search field takes the keyboard as the open
  shortcut does (`take_keyboard`), and gives it back when the notch closes.
- Notifications come from Windows' own notification database, which
  `win/notifications.rs` opens read only while `[notifications] in_notch`
  is on: a change to its folder, or a look every 2 s, finds the toasts that
  arrived since the last read. Each toast's XML (`src/toast.rs`, tested
  everywhere) gives the title, the lines under it, the app's logo and the
  buttons that open something (system and background buttons are left
  out). The app's name and icon come from Windows' Apps folder, the logo
  is copied to the cache for the page. Nothing shows while Windows holds
  its banners back (away, presenting, Do not disturb). `Notifications1`
  (bridge only) sends `Posted` to the notch on the monitor in use;
  `Activate(id, button)` opens the toast's protocol URI, if it has one,
  else its app. Windows still shows its own banner unless the user turns
  them off per app. The page (`views/notification.ts`) draws the
  extension's notification: the picture (round for a person, a bell on the
  accent without one), the stacked count, two lines from
  `notificationLines`, up to three buttons and a close button, timed as a
  download's preview, and never over a fullscreen app.
- The calendar comes from the `[calendar] feeds` the core reads
  (`calendar/feeds.rs`): `Calendar1` (bridge only) sends `Events`, each
  with its meeting link and color. The page (`src/calendar.ts`) keeps the
  ones not ended that start by the end of tomorrow, as GNOME's event
  source does, and runs the extension's calendar logic on them: home's
  agenda (`views/calendar.ts`), one timeout for the next reminder or start
  (a meeting's as a notification with Join, else a calendar alert) and
  the closed notch's countdown in the indicator's spot. A row opens the
  feed's calendar on the web (Google, Outlook, iCloud), Join the meeting.
- The closed notch's progress line (`[appearance] progress_line`) follows
  the extension's `progressLine`: the focus session or a countdown in the
  indicator's spot, else the song beside the cover. It fills with one
  linear CSS transition to its end and starts again on each change.
- The tray icon stands in for the top bar (Quit). A second start leaves
  the running one alone.
- The NSIS installer installs per user without admin rights, brings the
  WebView2 bootstrapper, and starts Nokta at login through the `Run` key
  (`installer.nsh`), which Task Manager's Startup apps can turn off.
- `npm run shots` shoots the page in Chrome on a stand-in desktop
  (`?mock=<scene>`), the check that runs anywhere. `windows.yml` builds the
  installer on `windows-latest`, installs and starts it, checks that a
  click beside the notch passes and one on it does not
  (`tools/windows/hit.ps1`), and uploads screenshots of the real desktop
  (`tools/windows/shot.ps1`).

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
| Windows app | Tauri 2 (WebView2), the `windows` crate for Win32 |
| Windows page | TypeScript built by Vite, no UI framework; Vitest with happy-dom |
| License | GPL-3.0-or-later |

A GNOME version is added to `shell-version` in `metadata.json` only after the
smoke test passes on it in CI (`.github/workflows/gnome.yml`).

Where GNOME versions differ, `extension/src/shared/compat.ts` and the OSD
hook check for the feature (a property or a method), never the version
number. Code is written against the GNOME 46 typings; anything newer goes
through such a check.
