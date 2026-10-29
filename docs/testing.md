# Testing Nokta

Nokta has four layers of tests. The first three run in CI; the last is done by
hand before a release and after any change to the extension's UI.

| Layer | Command | What it covers |
|---|---|---|
| Daemon | `cargo test` | Player selection, MPRIS following, LRC parsing, LRCLIB client, caches, config, every D-Bus interface against `contracts/*.xml`. Integration tests run on a private `dbus-daemon` with fake players and a local LRCLIB stub; nothing touches the real session or the network. |
| Extension logic | `cd extension && npm test` | Pure modules without `gi://` imports: position extrapolation, lyric line lookup, time and clock formatting, the hover state machine (click mode, opening held from the keyboard), the keys of the keyboard mode, shortcut parsing, settings parsing, colors, progress math. |
| GNOME versions | `tools/devshell/smoke.sh`, in CI per version | Inside a headless GNOME Shell 46, 48, 49, 50 and 51 (one container each): the extension is active, the playing, idle and OSD notch have the right size, hovering the idle notch opens home, its toggles change GNOME's settings, `[home]` picks and orders its toggles and tiles, the Screenshot tile opens GNOME's screenshot UI, the open shortcut (a real key press) opens the notch and holds the keyboard, Tab and Shift+Tab move the focus, the output menu and the right-click menu still open over it, the pointer leaving keeps it open, Enter presses the focused button, Escape, the shortcut again and a click outside close it and let go, with `open_on = "click"` hovering does not open the notch and a click does, the right-click menu opens, its notifications tile opens the calendar, a notification shows its buttons, closes with ×, and counts the ones stacked from the same app, a fullscreen window hides the notch, a countdown alert shows over it (unredirection off, hover does not open it) and hides again while a volume OSD and, with `fullscreen_alerts = "none"`, an alert leave it hidden, the settings window opens, and Nokta logs no errors. Screenshots are kept as job artifacts. |
| UI | `tools/devshell/` and the checklist below | What the notch looks like and how it behaves inside a real GNOME Shell. |

`npm run check` (types and the contract check) and `npm run lint` also run in
CI.

## The devshell

`tools/devshell/run.sh` starts the installed GNOME Shell headless with Nokta in it,
fully isolated from your session:

- its own session bus (a bare `dbus-daemon` that cannot start system
  services), so it never sees your players or your running `noktad`;
- temporary `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and
  `XDG_RUNTIME_DIR` under `build/devshell/`;
- GSettings in a keyfile there instead of dconf, so your settings are never
  read or written;
- a fake MPRIS player (`fake-player.js`, one 200 s track with a generated
  cover) and a local LRCLIB stand-in that always answers with
  `lyrics.json`;
- a fake UPower and BlueZ (`fake-devices.js`: a battery at 76 % on AC and a
  pair of earbuds), which `noktad` reaches as its system bus there;
- a fake GNOME session manager (`fake-session.js`) that only keeps
  inhibitors, for the Caffeine toggle.
- its own PipeWire (`pipewire.conf`) with two silent outputs, Speakers and
  Headphones, and a silent microphone, when `pipewire-pulse` and `pw-metadata` are installed. It sits
  in the devshell's runtime directory, so your real sound is never touched.

It also loads `devtools@nokta.io`, a development-only extension that allows
screenshots and `Eval` inside that shell. It is never packed or installed.

```sh
cargo build --release                       # or cargo build
(cd extension && npm ci && npm run pack)    # build/nokta@nokta.io.shell-extension.zip
tools/devshell/run.sh                       # stays in the foreground
```

In another terminal:

```sh
tools/devshell/shot.sh NAME           # build/shots/NAME.png and NAME-notch.png (crop)
tools/devshell/hover.sh on|off        # pointer onto the notch / away from it
tools/devshell/player.sh Playing|Paused|Stopped [N]  # N: player N from --players
tools/devshell/osd.sh level ICON LEVEL [MAX]  # an OSD as gnome-settings-daemon sends it
tools/devshell/osd.sh label ICON TEXT
tools/devshell/osd.sh capslock        # toggle Caps Lock with a virtual keyboard
tools/devshell/osd.sh numlock         # the same for Num Lock
tools/devshell/osd.sh layout          # switch to the next keyboard layout
tools/devshell/device.sh plug|unplug  # the fake charger
tools/devshell/device.sh percent N    # the fake battery level
tools/devshell/device.sh full         # charged to 100 % on AC
tools/devshell/device.sh connect [NAME] [BATTERY]  # earbuds; no BATTERY = none reported
tools/devshell/device.sh disconnect
tools/devshell/timer.sh start focus|break  # noktad's focus timer
tools/devshell/timer.sh pause|resume|stop
tools/devshell/timer.sh countdown SECONDS [LABEL]  # a countdown; also stopwatch [LABEL], clear
tools/devshell/mic.sh on|off               # a fake call: Fake Call records from the silent microphone
tools/devshell/fullscreen.sh on|off        # a window fullscreen on the primary monitor, or closed again
tools/devshell/activity.sh set ID TITLE DETAIL PROGRESS  # a live activity; PROGRESS -1 = unknown
tools/devshell/activity.sh end ID ok|failed [MESSAGE]
tools/devshell/prefs.sh               # open the settings window there
tools/devshell/click.sh X Y           # click at a point of the full screenshot
tools/devshell/keys.sh KEY...         # press keys together, e.g. Super_L Alt_L f
tools/devshell/smoke.sh               # start, check, stop (what CI runs per GNOME version)
tools/devshell/stop.sh
```

`run.sh --no-daemon` starts without `noktad`, `--no-player` without the fake
player, `--no-audio` without the private PipeWire, and `--players=N` with N fake players (the others start paused). Logs of every process are in `build/devshell/*.log`; the shell's is
`shell.log`, and a clean run has no `JS ERROR` or `JS WARNING` lines.

The daemon's config file in the devshell is
`build/devshell/config/nokta/config.toml`; edit it while the devshell runs to
test live reload.

## Manual checklist

Run through this in the devshell, and the items marked *(real session)* on a
real GNOME 46 session with the extension installed. Look at the
`*-notch.png` crops at full size: the notch must touch the top edge, the ears
must curve inward, the notch must be centered, and no text may be clipped.

### States

- [ ] **Idle**, no player (`player.sh Stopped`): clock only, `idle_width` wide.
- [ ] **Idle**, no daemon (`run.sh --no-daemon`): same as above, no errors in
      `shell.log`.
- [ ] Clock follows `clock-format`: 24 h shows `HH:MM`, 12 h shows `h:MM`
      without AM/PM.
- [ ] **Collapsed, playing**: small cover on the left, equalizer bars moving
      on the right, `playing_width` wide.
- [ ] **Collapsed, paused**: same, bars at rest.
- [ ] **Expanded** (`hover.sh on`, wait more than `open_delay_ms`): cover,
      title, artists, lyric line, progress with elapsed and total time,
      previous / play-pause / next.
- [ ] Expanded and paused: play icon instead of pause, time stops.
- [ ] **Players** (`run.sh --players=2`): expanded shows the player's name
      with an arrow on each side under the artists; an arrow or a wheel
      click over the cover switches to the paused player and it stays while
      the other plays; `player.sh Paused` then `player.sh Playing` switches
      back; `player.sh Stopped 2` hides the arrows.
- [ ] Leaving (`hover.sh off`) closes after `close_delay_ms`; moving back on
      during that delay keeps it open.
- [ ] **Home** (`player.sh Stopped`, `hover.sh on`): the date, three
      toggles (Do Not Disturb, Caffeine, Dark Style) and three tiles
      (Notifications with a count badge, Focus, Settings), 420 px wide and
      160 px tall. The Notifications tile closes home and opens GNOME's
      calendar under the top bar, also with the clock hidden by another
      extension. The Focus tile starts focus and lights up; again stops it.
      Settings opens the settings window.
- [ ] Toggles: each one fills with the accent while on and changes the
      devshell's own setting (`show-banners`, `color-scheme`); Caffeine
      shows `inhibit` in `build/devshell/session.log`. Do Not Disturb turned
      on during a focus session stays on after it.
- [ ] Settings window, **Home** page: each toggle and tile has a switch and
      up and down buttons; with three toggles on, Night Light's switch is
      off and greyed. Moving and switching changes home at once and writes
      `[home]` in `config.toml`. Without toggles home is 116 px tall,
      without tiles 89. Night Light changes `night-light-enabled`; the
      Screenshot tile closes the notch, then opens GNOME's screenshot UI
      without the notch in it.
- [ ] With a player: the grid button at the player's top right opens home
      with a music button beside the date, which goes back. Leaving and
      hovering again opens the player.
- [ ] Right click on the notch: a menu at the pointer with Settings, Do Not
      Disturb (the same switch as the toggle), with files on the shelf
      Clear shelf, and with the clipboard history on Pause clipboard.
- [ ] `target/release/nokta settings` opens the settings window.
- [ ] A player stopping or starting under the pointer swaps the panel and
      the player view without closing.
- [ ] Passing over the notch quickly (less than `open_delay_ms`) does not
      open it.
- [ ] **Motion**: opening, width and height grow together, overshoot a few
      pixels and settle; the corners round more as it opens. Closing does
      not overshoot. `hover.sh on`, then `hover.sh off` right after it
      starts to open: it turns back from where it is, without a jump. The
      ears stay attached to the body the whole time.

### Content

- [ ] Long title and artist: ellipsized at the end, layout unchanged.
- [ ] No cover: grey square with a note icon.
- [ ] No lyrics (remove `lyrics.json` from `build/devshell/lrclib/api/get`
      before the track starts, or test a track LRCLIB does not know)
      *(real session)*: the lyric row is gone and the view still looks
      complete.
- [ ] Synced lyrics: the line lights up from left to right and ends lit
      when the next line starts; the next line shows dimmed under it. A new
      line slides up and fades in. The intro and empty lines show `♪`, fully
      lit. Pause: the fill stops; play: it carries on.
- [ ] `show_lyrics = false`: the lyric row is hidden.
- [ ] Unknown length (`LengthUs` 0, e.g. a live stream) *(real session)*:
      no progress row.
- [ ] Accent: progress fill and bars take the cover's color with
      `use_album_accent = true`, the foreground color otherwise.

### OSD

- [ ] `osd.sh level audio-volume-medium-symbolic 0.45` from idle, collapsed
      and expanded: the notch widens to `osd_width` with icon, bar and
      `45%`; GNOME's popup at the bottom does not appear.
- [ ] After `osd_duration_ms` the notch goes back to the state it was in
      (expanded again when the pointer is still on it).
- [ ] Several requests in a row: the bar moves in place, the notch does not
      shrink in between.
- [ ] `osd.sh level audio-volume-high-symbolic 1.2 1.5`: bar at 80 %, text
      `120%`.
- [ ] `osd.sh label airplane-mode-symbolic "Airplane mode on"`: no bar, the
      text on the left.
- [ ] `osd.sh capslock` twice: `Caps Lock on`, then `Caps Lock off`. No
      message when the extension is enabled.
- [ ] `osd.sh numlock`: nothing by default; with `show_num_lock = true`,
      `Num Lock on`, then `Num Lock off`.
- [ ] `osd.sh layout`: the new layout's name, like `German`; again: the
      first one. `show_input_source = false`: nothing.
- [ ] `osd.sh level audio-volume-muted-symbolic 0`: `Muted`, no bar.
      `osd.sh level microphone-sensitivity-muted-symbolic 0`:
      `Microphone off`, no bar.
- [ ] `replace_osd = false` while running: GNOME's popup again; back to
      `true`: the notch again. `show_caps_lock = false`: no Caps Lock message.
- [ ] Disabled extension: GNOME's popup again.
- [ ] Volume keys during a fullscreen video *(real session)*: GNOME's popup;
      with `fullscreen_alerts = "all"`, the notch.
- [ ] Brightness and volume keys, mic mute key *(real session)*: in the
      notch.

### Several monitors

Start with `run.sh --monitors=2`; `shot.sh` then also writes
`NAME-notch-1.png` for the second monitor.

- [ ] Each monitor has a notch; `hover.sh on 1` opens only the second one,
      `hover.sh on 0` only the first.
- [ ] Pointer on monitor 1 (`hover.sh off 1`), `osd.sh level ... 0.5`: the OSD
      shows only on monitor 1. Same for `osd.sh capslock`.
- [ ] `CONNECTOR=Meta-1 osd.sh level display-brightness-symbolic 0.7` with the
      pointer on monitor 0: the OSD shows only on monitor 1.
- [ ] `all_monitors = false` while running: one notch on the primary; an OSD
      from monitor 1 shows there. Back to `true`: two notches again.
- [ ] Volume keys with a focused window on the other monitor *(real
      session)*: the OSD follows the focused window, not the pointer.
- [ ] Fullscreen app on one monitor *(real session)*: only that monitor's
      notch hides; volume keys there show GNOME's popup on that monitor.

### Device alerts

Wait for each alert to close (`alert_duration_ms`, 3 s) before the next.

- [ ] `device.sh unplug`: `On battery 76%`; `device.sh plug`: `Charging 76%`.
- [ ] `device.sh connect "Galaxy Buds2" 82`: `Galaxy Buds2 82%`;
      `device.sh disconnect`: `Galaxy Buds2 Disconnected`.
- [ ] `device.sh connect` without a battery: `Connected` after about 2 s.
- [ ] Unplugged, `device.sh percent 20`: `Battery low 20%` once;
      `percent 9`: `Battery critical 9%` in red, once.
- [ ] `device.sh full`: `Fully charged 100%`.
- [ ] `device_alerts = false` while running: none of these show.
- [ ] Real earbuds and a real charger *(real session)*.

### Focus timer

Set `focus_minutes = 1` and `break_minutes = 1` to see a whole cycle.

- [ ] `timer.sh start focus` while playing: a tomato dot and `24:59` replace
      the equalizer; with nothing playing they replace the clock.
- [ ] `timer.sh pause`: the time stops and dims; `resume` goes on.
- [ ] Quick Settings has **Focus** with `25 min`, then `24 min left` while
      running. Its menu starts focus and break, pauses, resumes and stops;
      Start break is gone with `break_minutes = 0`.
- [ ] When focus ends: `Focus done 1 min break`, then a green `0:59`. When the
      break ends: `Break over`, then the clock.
- [ ] Long break: with `sessions_before_long_break = 2` and
      `long_break_minutes = 2`, the second focus ends with
      `Focus done 2 min long break`; Quick Settings says `Long break, 2 min
      left`, and while idle before it the menu says `Start long break, 2 min`.
      `timer.sh stop` starts the count again.
- [ ] Quiet notifications: while focus runs,
      `gsettings get org.gnome.desktop.notifications show-banners` in the
      devshell says `false`; after `timer.sh pause`, `stop` or the break it
      says `true` again, and also after disabling the extension mid-focus.
      Banners already off before focus stay off.
- [ ] Shortcut: `<Super><Alt>f` starts focus, again stops it (pressed
      with `tools/devshell/keys.sh`, or by hand in a real session). Setting
      `shortcut = ""` frees the keys; `"<Control><Alt>t"` moves them.
- [ ] The sound *(real session)*; lock the screen while running and unlock:
      the timer went on *(real session)*.
- [ ] On GNOME 49 or later, the shortcut does not open the overview
      *(real session)*. The devshell's virtual Super key can, so the smoke
      test closes it before the settings window.

### Timers, stopwatches and alarms

With the devshell's bus (`export DBUS_SESSION_BUS_ADDRESS=$(cat
build/devshell/bus)`), `target/release/nokta` drives them like a user would.

- [ ] `nokta timer 10m Tea`: an orange dot and `9:59` replace the clock.
      `nokta stopwatch Run` adds a blue one, but the countdown keeps the
      spot. A focus timer wins over both.
- [ ] `nokta alarm HH:MM Sleep` more than an hour ahead: not in the closed
      notch; less than an hour ahead: a violet dot and the time left.
- [ ] Hover: home lists the newest three, with the label, `10 min` or the
      alarm's time dimmed, the time ticking each second, pause (not for an
      alarm) and remove. Paused, the time dims and says `Paused`.
- [ ] The **Timer** tile is lit while any run. It opens 1, 3, 5, 10, 15 and
      30 min and Stopwatch; one starts it and goes back home.
- [ ] `timer.sh countdown 3 Eggs`: `Eggs Timer done` shows for twice the
      alert duration; without a label, `Timer done`.
- [ ] `nokta timer soon` and `nokta alarm 25:00` say what is wrong; a
      seventh clock says there are already 6.
- [ ] The sound (`alarm-clock-elapsed`), and an alarm due while suspended
      rings right after resume *(real session)*.

### Shuffle, repeat and the lyrics view

- [ ] Hover while the fake player plays: shuffle left of Previous and repeat
      right of Next, both dimmed. Shuffle lights up; repeat goes all, one
      (the repeat-one icon), then off.
- [ ] A player without shuffle or repeat (a browser) *(real session)*: no
      buttons for them.
- [ ] Click the lyric row: the notch grows to 336 px and shows seven lines,
      the current one larger and lit as it is sung; they slide up as lines
      change. Under them `−`, `On time` and `+`, with nothing cut off above
      the seek bar.
      A click on the lines, the next track or moving the pointer away
      closes it.
- [ ] Click `+` twice: the label says `0.5 s earlier`, the view stays open,
      the lines change half a second sooner and the lit part of the current
      line jumps ahead. `−` three times: `0.25 s later`. `OffsetMs` on
      `/io/nokta/Lyrics` follows, and
      `build/devshell/data/nokta/lyrics-offsets.toml` has one line.
- [ ] Next track and back: the new one is `On time`, the first one keeps
      its timing. A click on the label puts it back to `On time` and takes
      its line out of the file. (`run.sh` starts with an empty data folder,
      so keeping it across a restart is left to `cargo test`.)

### Sound output

- [ ] Hover while the fake player plays: a speaker button left of the grid
      button. A click opens a menu with Headphones and Speakers, Speakers
      checked; the notch stays open while it shows, even with the pointer
      away.
- [ ] Pick Headphones: the menu closes, the button shows headphones, and
      Quick Settings' sound menu shows the same output.
- [ ] `run.sh --no-audio`: no speaker button.
- [ ] Plug in or connect headphones *(real session)*: they show in the menu
      right away; picking them moves the sound like Quick Settings does.

### Live activities

- [ ] `activity.sh set b Backup Photos 0.4`: an icon and `40%` replace the
      clock; while playing they replace the equalizer. A focus timer wins
      over it.
- [ ] `activity.sh set c "cargo build" "" -1`: the newest one shows, its
      icon pulsing slowly.
- [ ] Hover: the panel lists up to three, newest first, each with a bar
      (none while unknown) and an elapsed time that ticks each second. The
      panel grows and shrinks as they come and go.
- [ ] `activity.sh end b ok`: a check mark, `Backup`, `Done in …`;
      `activity.sh end c failed "Disk full"` in red.
- [ ] With `stale_minutes = 1`, one not set again ends as failed with `No
      update for 1 minute`.
- [ ] `live_activities = false` while running: nothing shows; `Set` still
      works.
- [ ] After `. tools/devshell/env.sh`, `target/release/nokta run -- sleep 5`:
      `sleep 5` while it runs, then `Done in 5 s`. Again in a real session
      *(real session)*.

### Weather

- [ ] The smoke test sets `location` to `Jakarta`; the fake Open-Meteo
      answers. Hover the idle notch: a partly cloudy icon, `31°`, then
      `Jakarta · 33° / 25°` dimmed, at the end of the date line.
- [ ] `location = "-6.2,106.8"`: the same, without the place name.
- [ ] `units = "fahrenheit"`: the weather goes away, then comes back from a
      new request. `enabled = false` or `location = ""`: no weather, and
      `noktad.log` shows no request.
- [ ] With the fake server stopped, a refresh more than 30 minutes later
      fails and the last reading stays.
- [ ] The Weather group in the settings window changes all three.
- [ ] A real city in a real session *(real session)*.

### Calendar

- [ ] The smoke test puts `Smoke standup` 5 minutes ahead in the date
      menu's event source: the panel shows a calendar row, `Smoke standup`,
      then its time and `in 6 min` dimmed, 28 px taller. Its reminder,
      `Smoke standup in 5 min`, shows like a device alert.
- [ ] At the start time: `Smoke standup is starting` with its start and end.
- [ ] An all-day event shows no row. `enabled = false`: no row and no
      reminder. `reminder_minutes = 0`: only the start.
- [ ] A click on the row opens the calendar app, or the date menu without
      one.
- [ ] A real event from an online account in a real session *(real
      session)*.

### File shelf

`tools/devshell/drop.sh FILE...` drags files from a small window onto the
notch and drops them; with `--hold` it stops over the notch until
`drop.sh --release`. The window takes drops too and prints them in
`build/devshell/drag-source.log`, so it can be the target of a drag out of
the shelf.

- [ ] The smoke test drops a file: the drop area opens (`Drop to keep
      here`, a dashed outline), the file is in `Shelf1.Items`, the closed
      notch shows `1` in place of the clock, and the panel is 54 px taller
      with the stack and the file. The pointer on the file shows its close
      button; a click on it takes the file off and the clock comes back.
      Later a screenshot kept on the shelf shows its thumbnail
      (`Shelf1.Thumbnails`) in place of the icon.
- [ ] The helper window (`nokta-shelf`) is a dock at -10000, -10000 while
      nothing needs it, and is not in Alt+Tab or the overview.
- [ ] Drop 2 files, then drag one from the open notch onto the drop.sh
      window (start it again with no files): the window prints it and it
      leaves the shelf. Dragging the stack takes both. A picture drags
      with its thumbnail under the pointer.
- [ ] A click on a file opens it in its app.
- [ ] Delete or move a parked file: it leaves the shelf. More than 30
      files: the oldest go.
- [ ] Kill the helper (`pkill -f 'shelf-helper/[m]ain.js'`): it starts
      again and drops still work.
- [ ] `file_shelf = false` while running: no badge, no row, no drop area,
      and the helper ends.
- [ ] Drag a photo from Files and from a browser onto the notch, then drag
      it from the notch into a WhatsApp or Telegram chat *(real session)*.

### Clipboard history

`. tools/devshell/env.sh`, then copy with
`shell_eval "imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD, 'Some text'); 'ok'"`.
`Clipboard1.Items` on the devshell bus shows what `noktad` kept.

- [ ] The smoke test copies text: it is in `Clipboard1.Items`, home has a
      `Clipboard` tile, and the tile opens the list (98 px tall with one
      row). A new copy goes on top, a click on a row copies it back and
      moves it up, its pin keeps it through `Clear()`, and the back arrow
      goes home. `Pause clipboard` in the right-click menu pauses the
      history, and a copy while paused is not kept.
- [ ] The smoke test searches: the search button opens a field with the
      keyboard (168 px with two rows), typing `SECOND` leaves one row
      (132 px), and Enter copies it and closes the field.
- [ ] While searching, the notch stays open with the pointer away; a click
      outside it closes the field, and the notch closes after
      `close_delay_ms`. Escape closes the field; with the pointer still on
      the notch, the page stays.
- [ ] A search with no match says `No match`. `Café` is found with `cafe`;
      `picture` finds every picture.
- [ ] Copy a PNG with `St.Clipboard.set_content(..., 'image/png', bytes)`:
      the row shows `Picture · W × H` with its thumbnail, a file in
      `build/devshell/runtime/nokta/clipboard/`. Removing the entry deletes
      the file.
- [ ] More than 5 entries: scrolling over the list shows older ones, and
      closing the notch goes back to the top.
- [ ] The pause button in the header turns into a play button in the
      accent while paused; the empty list says `Paused: copies are not
      kept`.
- [ ] `[clipboard] enabled = false` while running: the tile goes, an open
      list goes back home, and `Items` is empty. `max_items = 5`: the
      oldest unpinned entries go.
- [ ] Copy a password from a password manager (KeePassXC) *(real session)*:
      it is not kept.

### Privacy dots

`. tools/devshell/env.sh`, then with
`QS=Main.panel.statusArea.quickSettings`:

- [ ] `shell_eval "$QS._camera._indicator.visible = true"`: a green dot
      centered in the notch's rounded left corner, idle and collapsed; the
      cover moves right to make room. None while expanded.
- [ ] `shell_eval "$QS._volumeInput._indicator.visible = true"`: an orange
      dot next to the green one; turning both off removes them and the
      cover moves back.
- [ ] `privacy_dots = false` while running: no dots.
- [ ] A real webcam, a call with the microphone and screen sharing
      *(real session)*.

### Calls

- [ ] `player.sh Stopped`, then `mic.sh on`: an orange microphone and
      `0:01`, counting, replace the clock; while playing they sit beside
      the cover.
- [ ] Hover: home has a row with the phone icon, **Fake Call** and
      `Microphone · 0:05`, the notch 36 px taller.
- [ ] Its microphone button: `Muted · …`, the icon crossed out and red in
      home and the closed notch; Quick Settings shows the microphone muted.
      Again unmutes.
- [ ] Its close button: the row and the closed notch's microphone go away;
      `mic.sh off`, then `mic.sh on` brings them back.
- [ ] `call_indicator = false` while running: no microphone, no row.
- [ ] A real call (Meet in a browser, Zoom, Discord) *(real session)*: the
      app's name and icon, and the mute button mutes it for the others.

### Notifications

Send one with `. tools/devshell/env.sh`, then
`gdbus call --session --dest org.gnome.Shell --object-path /org/freedesktop/Notifications --method org.freedesktop.Notifications.Notify APP "uint32 0" "" TITLE BODY "@as []" "@a{sv} {}" "int32 -1"`
(add `"@a{sv} {'urgency': <byte 2>}"` instead of `{}` for a critical one,
and `"@as ['default', 'Open', 'reply', 'Reply', 'archive', 'Archive']"`
instead of `"@as []"` for buttons).

- [ ] A notification shows in the notch, 420 px wide and two lines tall:
      the title, then the body as plain text (markup removed, `&amp;` as
      `&`). No GNOME banner. It closes after `duration_ms`.
- [ ] With the pointer on it, it stays; it closes about 1.5 s after the
      pointer leaves.
- [ ] A click opens it like GNOME's banner: it leaves the message list and
      the notch closes.
- [ ] With actions, up to three buttons show in one row under the two
      lines, and the notch is 32 px taller (92 px). A button runs its
      action and the notch closes; the `default` action is the click on
      the notification, not a button.
- [ ] × at the right closes it in the notch; it stays in GNOME's message
      list.
- [ ] A second and third from the same app while one shows replace it and
      show `2`, `3` on the icon (`9+` after nine); one from another app
      shows no count.
- [ ] A volume OSD during a notification shows over it; the notification
      comes back when the OSD ends.
- [ ] A critical notification uses GNOME's banner.
- [ ] `show_body = false`: the second line names the app.
- [ ] `in_notch = false` while running: GNOME's banner again.
- [ ] Do Not Disturb and a real app's notification *(real session)*: none
      in the notch while Do Not Disturb is on; clicking a chat message
      opens the chat.

### Screenshot previews

`tools/devshell/smoke.sh` shows a fake `Screenshot captured` notification,
made the way GNOME makes it, and then names its file as the screenshot UI
does.

- [ ] The preview shows the picture, the title, `Open` and `Show in
      Files`, in place of the banner. `Keep on shelf` joins them once the
      file is known.
- [ ] `Keep on shelf` puts the file on the shelf and closes the preview.
- [ ] `screenshot_preview = false`, or `file_shelf = false`: a normal
      notification, or no `Keep on shelf`.
- [ ] Real screenshots *(real session)*: Print Screen in the screenshot
      UI shows all three buttons; Shift+Print Screen shows `Open` and
      `Show in Files`. `Open` opens the image viewer, `Show in Files`
      selects the file in Files, and a kept screenshot drags into a chat.

### Screen recordings

`smoke.sh` tells GNOME's screenshot UI that it records (there is no
recorder in the devshell) and then shows its own `Screencast recorded`
banner for a fake file.

- [ ] `shell_eval "Main.screenshotUI._setScreencastInProgress(true)"`: a
      red dot and `0:01`, counting, replace the clock; while playing they
      sit beside the cover.
- [ ] Hover: home has a **Screen recording** row with the time and a stop
      button, the notch 36 px taller. Stop takes the row and the dot away.
- [ ] The `Screencast recorded` banner shows as a preview with a video
      icon, `Open`, `Show in Files` and `Keep on shelf`.
- [ ] A real recording *(real session)*: Ctrl+Shift+Alt+R or the screenshot
      UI's video mode starts it, the notch's stop button stops it and saves
      the video, `Open` plays it and a kept video drags into a chat.

### Appearance and clock

- [ ] **Themes**: set `theme` to each value with a song playing, open and
      closed. Midnight is black; graphite dark grey with a fine edge;
      glass see-through with a fine edge; aurora a dark shade of the
      cover's color that changes with the track (midnight without a
      cover); paper light with dark text, also in the idle panel. Only
      `custom` follows `background`, `foreground` and `accent`.
- [ ] The play button is a round button filled with the accent, its icon
      readable on it; it lifts under the pointer and sinks when pressed.
      Shuffle and repeat take the accent while on.

- [ ] `clock_format = "24h"` with nothing playing: 11 pm shows `23:..`;
      `"12h"` shows `11:..`; `"system"` follows GNOME.
- [ ] `show_clock = false`: the idle notch is empty.
- [ ] `background_opacity = 0.4`: body and ears see-through, the clock text
      solid.
- [ ] `theme = "custom"`, `background = "#ff0000"`, `background_end =
      "#0000ff"`: `gradient = "down"` runs red at the top to blue at the
      bottom, `"across"` red at the left to blue at the right, `"diagonal"`
      from the top left to the bottom right, ears in the top's color; the
      settings window's preview and Custom card run the same way.
- [ ] `follow_system_style = true`: switching Settings → Appearance to Light
      turns the notch to `light_theme` (Paper) at once, and Dark back to
      `theme`; with the light style on, a swatch on the notch's settings page
      changes `light_theme` and the notch shows it.
- [ ] `theme = "picture"`, `picture = "~/Pictures/..."`: the closed notch
      shows the top middle of the picture, darkened, with readable text;
      opening shows more of the same picture, not a stretched one.
      `picture_blur = 20` blurs it; `picture_darken = 0.8` makes it nearly
      black. A missing file draws like midnight, and the settings window's
      Picture row says it can't read it. The settings window's preview,
      Picture card and the notch's Picture swatch show the picture.
- [ ] `cover_backdrop = true` with a song that has a cover: opening the
      player fades the cover in behind it, blurred and darkened, with white
      text; the grid button (home) fades it out, and a song without a cover
      shows the theme. The next song swaps to its own cover, never the old
      one. With the picture theme, closing goes back to its own picture.
- [ ] `use_album_accent = false`, `accent = "#ff8800"`: orange equalizer and
      progress bar while playing, orange OSD bar.
- [ ] **Progress line**: a song playing, closed: a thin line in the accent
      along the bottom, inset from the corners, at the song's position and
      moving smoothly; it stops while paused and jumps on a seek. Open the
      notch: no line.
- [ ] `timer.sh countdown 20`: the line fills over 20 s. A focus timer
      fills over its session; paused, it stands still. An activity with a
      progress shows it; one without has no line.
- [ ] A call or a screen recording: no line, not even the song's.
- [ ] `progress_line = false`: no line anywhere.
- [ ] **Alert bounce and glow**: `device.sh unplug`, then `device.sh plug`:
      the notch opens to `Charging`, overshoots a little wider and springs
      back, with a green glow under it that fades with the alert.
      `device.sh percent 4` while unplugged: a red glow. A finished
      countdown glows orange, a focus session in its phase color, a
      notification or `Connected` in the accent.
- [ ] A volume, brightness or Caps Lock popup neither bounces nor glows.
- [ ] `alert_glow = false`: the bounce stays, no glow. GNOME's animations
      off (Accessibility, Reduce Animation): the glow shows, no bounce.

### Settings window

- [ ] `prefs.sh`: three pages, Appearance, Behavior and Home, with the values of
      `config.toml`; no banner.
- [ ] Change a switch and a number (`click.sh`; the first click may only
      focus the window): `config.toml` changes with its comments kept, the
      notch follows, and `noktad.log` shows one `set` per change even after
      several quick clicks.
- [ ] Edit `config.toml` by hand: the open window follows.
- [ ] Break `config.toml`, then change a setting: a message says what is
      wrong and the row goes back.
- [ ] Reset all settings: a confirmation, then the default `config.toml`.
- [ ] Stop the daemon: a banner says so and the rows are dimmed.
- [ ] The Settings button in the Extensions app opens it *(real session)*.

### Keyboard and click to open

- [ ] `keys.sh Super_L Alt_L n` while playing: the player opens and its
      first button has a focus ring; with nothing playing, home opens. In
      Looking Glass (or `shell_eval`), `Main.actionMode` is `128` (popup)
      and `global.stage.key_focus` is a button in the notch.
- [ ] `keys.sh Tab` and `keys.sh Shift_L Tab` move the ring round the
      buttons; `keys.sh Left`, `Right`, `Up` and `Down` move it to the
      nearest button that way.
- [ ] `keys.sh Return` (or `space`) presses the focused button: the grid
      button opens home, whose first button takes the ring; a home tile
      that leaves the notch (Settings, Notifications) closes it and lets go
      of the keyboard.
- [ ] `hover.sh on`, then `hover.sh off`: the notch stays open.
- [ ] `keys.sh Escape`, the shortcut again, or `click.sh 200 600` (outside):
      it closes and `Main.actionMode` is `1` again.
- [ ] While held: a right click opens the menu and the speaker button its
      output menu; Escape closes that menu first, and the ring comes back.
- [ ] The clipboard's search while held (`Tab` to the Clipboard tile,
      Enter, then the magnifier): typing goes to the field, Escape closes
      the field and the ring goes back to the page, a second Escape closes
      the notch.
- [ ] The ring with each theme: light on the dark ones, dark on `paper`
      and a light `custom` background, grey on the play button.
- [ ] `open_shortcut = ""` frees the keys; `"<Control><Alt>space"` moves
      them. GNOME binds nothing to `<Super><Alt>n` (`<Super>n` is its
      "focus the notification" shortcut).
- [ ] `open_on = "click"`: `hover.sh on` does not open the notch; a click
      on it does; `hover.sh off` closes it after `close_delay_ms`. A right
      click still opens the menu.

### Interaction

- [ ] Play/pause, next and previous reach the player (`player.log` prints
      the new status for play/pause).
- [ ] Click on the progress bar seeks there; dragging moves the bar with the
      pointer and seeks on release.
- [ ] Buttons are dimmed and do nothing when the player cannot do the action.

### Lifecycle

- [ ] Disable and enable the extension 5 times
      (`gnome-extensions disable/enable nokta@nokta.io` in a real session,
      or `Main.extensionManager.disableExtension()` through `Eval` in the
      devshell): no errors, the date menu goes back to the center and returns
      to the right, nothing is left behind (no `nokta-shelf` window, no
      helper process).
- [ ] Stop the daemon (`kill $(cat build/devshell/noktad.pid)`, or
      `systemctl --user stop nokta` in a real session): the notch goes idle.
      Start it again *(real session)*: media comes back without re-enabling
      the extension.
- [ ] Edit `config.toml` while running (for example `playing_width`,
      `corner_radius`, `background`): the notch updates within a second.
      Make it invalid: the notch keeps the last valid config and the daemon
      logs the error with its location.
- [ ] Fullscreen app *(real session)*: the notch hides and comes back when
      leaving fullscreen.

### Over a fullscreen app

`fullscreen.sh on` opens a window that goes fullscreen on the primary
monitor; `fullscreen.sh off` closes it.

- [ ] `fullscreen.sh on`: the notch and the top bar hide.
- [ ] `timer.sh countdown 2 Tea`: `Tea` and `Timer done` show over the
      window with a glow; `hover.sh on` does not open the notch; it hides
      again when the alert ends.
- [ ] Unplugged, `device.sh percent 20`: `Battery low` over the window;
      `device.sh plug`: nothing.
- [ ] `timer.sh start focus` with `focus_minutes = 1`: `Focus done` over
      the window; the break's end too.
- [ ] `osd.sh level audio-volume-medium-symbolic 0.5`: GNOME's popup, not
      the notch; with `fullscreen_alerts = "all"`, the notch, which hides
      again after.
- [ ] `fullscreen_alerts = "none"`: the countdown shows nothing.
- [ ] A notification while fullscreen: GNOME holds it, and the notch shows
      nothing.
- [ ] `fullscreen.sh off`: the notch comes back, closed.
- [ ] Open the overview with the window fullscreen: the notch shows there.
- [ ] A game or video player in a real session *(real session)*: an alert
      shows over it (unredirection is off while it shows), and the game runs
      unredirected again after.
- [ ] Monitor change *(real session)*: plugging or unplugging a monitor, or
      changing the primary one, gives every monitor a notch centered at its
      top edge (only the primary with `all_monitors = false`).
- [ ] GNOME animations off (Settings, Accessibility, Reduce Animation)
      *(real session)*: all changes are instant and the bars stay still.

### Top bar and Just Perfection *(real session)*

- [ ] Without Just Perfection and `move_clock = true`: the date menu sits at
      the start of the right box; the calendar and notifications still open.
- [ ] `move_clock = false` while running: the date menu goes back to the
      center.
- [ ] With Just Perfection enabled: Nokta does not move the clock and logs
      one line; with Just Perfection's clock position set to Right, the notch
      covers nothing.

### Cost

Measure over 60 s windows with `/proc/<pid>/stat` or `pidstat`:

- [ ] `noktad` RSS below 15 MB and CPU 0.0 % while idle, paused and playing.
- [ ] `gnome-shell` CPU does not change measurably while idle or paused
      compared with the extension disabled.
