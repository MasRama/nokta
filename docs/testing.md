# Testing Nokta

Nokta has four layers of tests. The first three run in CI; the last is done by
hand before a release and after any change to the extension's UI.

| Layer | Command | What it covers |
|---|---|---|
| Daemon | `cargo test` | Player selection, MPRIS following, LRC parsing, LRCLIB client, caches, config, every D-Bus interface against `contracts/*.xml`. Integration tests run on a private `dbus-daemon` with fake players and a local LRCLIB stub; nothing touches the real session or the network. |
| Extension logic | `cd extension && npm test` | Pure modules without `gi://` imports: position extrapolation, lyric line lookup, time and clock formatting, the hover state machine, settings parsing, colors, progress math. |
| GNOME versions | `tools/devshell/smoke.sh`, in CI per version | Inside a headless GNOME Shell 46, 48, 49, 50 and 51 (one container each): the extension is active, the playing, idle and OSD notch have the right size, the settings window opens, and Nokta logs no errors. Screenshots are kept as job artifacts. |
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
  pair of earbuds), which `noktad` reaches as its system bus there.

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
tools/devshell/device.sh plug|unplug  # the fake charger
tools/devshell/device.sh percent N    # the fake battery level
tools/devshell/device.sh full         # charged to 100 % on AC
tools/devshell/device.sh connect [NAME] [BATTERY]  # earbuds; no BATTERY = none reported
tools/devshell/device.sh disconnect
tools/devshell/timer.sh start focus|break  # noktad's focus timer
tools/devshell/timer.sh pause|resume|stop
tools/devshell/prefs.sh               # open the settings window there
tools/devshell/click.sh X Y           # click at a point of the full screenshot
tools/devshell/keys.sh KEY...         # press keys together, e.g. Super_L Alt_L f
tools/devshell/smoke.sh               # start, check, stop (what CI runs per GNOME version)
tools/devshell/stop.sh
```

`run.sh --no-daemon` starts without `noktad`, `--no-player` without the fake
player, and `--players=N` with N fake players (the others start paused). Logs of every process are in `build/devshell/*.log`; the shell's is
`shell.log`, and a clean run has no `JS ERROR` or `JS WARNING` lines.

The daemon's config file in the devshell is
`build/devshell/config/nokta/config.toml`; edit it while the devshell runs to
test live reload.

## Manual checklist

Run through this in the devshell, and the items marked *(real session)* on a
real GNOME 46 session with the extension installed. Look at the
`*-notch.png` crops at full size: the notch must touch the top edge, the ears
must curve inward, the notch must be centered, and no text may be clipped.

### States (spec 6.2)

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
- [ ] Passing over the notch quickly (less than `open_delay_ms`) does not
      open it.

### Content

- [ ] Long title and artist: ellipsized at the end, layout unchanged.
- [ ] No cover: grey square with a note icon.
- [ ] No lyrics (remove `lyrics.json` from `build/devshell/lrclib/api/get`
      before the track starts, or test a track LRCLIB does not know)
      *(real session)*: the lyric row is gone and the view still looks
      complete.
- [ ] Synced lyrics: the line changes on time and crossfades; the intro and
      empty lines show `♪`.
- [ ] `show_lyrics = false`: the lyric row is hidden.
- [ ] Unknown length (`LengthUs` 0, e.g. a live stream) *(real session)*:
      no progress row.
- [ ] Accent: progress fill and bars take the cover's color with
      `use_album_accent = true`, the foreground color otherwise.

### OSD (v0.2 spec)

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
- [ ] `replace_osd = false` while running: GNOME's popup again; back to
      `true`: the notch again. `show_caps_lock = false`: no Caps Lock message.
- [ ] Disabled extension: GNOME's popup again.
- [ ] Volume keys during a fullscreen video *(real session)*: GNOME's popup.
- [ ] Brightness and volume keys, mic mute key *(real session)*: in the
      notch.

### Several monitors (multi-monitor spec)

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

### Device alerts (device alerts spec)

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

### Focus timer (focus timer spec)

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

### Notifications

Send one with `. tools/devshell/env.sh`, then
`gdbus call --session --dest org.gnome.Shell --object-path /org/freedesktop/Notifications --method org.freedesktop.Notifications.Notify APP "uint32 0" "" TITLE BODY "@as []" "@a{sv} {}" "int32 -1"`
(add `"@a{sv} {'urgency': <byte 2>}"` instead of `{}` for a critical one).

- [ ] A notification shows in the notch, 420 px wide and two lines tall:
      the title, then the body as plain text (markup removed, `&amp;` as
      `&`). No GNOME banner. It closes after `duration_ms`.
- [ ] With the pointer on it, it stays; it closes about 1.5 s after the
      pointer leaves.
- [ ] A click opens it like GNOME's banner: it leaves the message list and
      the notch closes.
- [ ] A volume OSD during a notification shows over it; the notification
      comes back when the OSD ends.
- [ ] A critical notification uses GNOME's banner.
- [ ] `show_body = false`: the second line names the app.
- [ ] `in_notch = false` while running: GNOME's banner again.
- [ ] Do Not Disturb and a real app's notification *(real session)*: none
      in the notch while Do Not Disturb is on; clicking a chat message
      opens the chat.

### Appearance and clock (settings window spec)

- [ ] `clock_format = "24h"` with nothing playing: 11 pm shows `23:..`;
      `"12h"` shows `11:..`; `"system"` follows GNOME.
- [ ] `show_clock = false`: the idle notch is empty.
- [ ] `background_opacity = 0.4`: body and ears see-through, the clock text
      solid.
- [ ] `use_album_accent = false`, `accent = "#ff8800"`: orange equalizer and
      progress bar while playing, orange OSD bar.

### Settings window (settings window spec)

- [ ] `prefs.sh`: two pages, Appearance and Behavior, with the values of
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
      to the right, nothing is left behind.
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

### Cost (spec 1, 6.5)

Measure over 60 s windows with `/proc/<pid>/stat` or `pidstat`:

- [ ] `noktad` RSS below 15 MB and CPU 0.0 % while idle, paused and playing.
- [ ] `gnome-shell` CPU does not change measurably while idle or paused
      compared with the extension disabled.
