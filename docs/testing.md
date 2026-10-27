# Testing Nokta

Nokta has three layers of tests. The first two run in CI; the third is done by
hand before a release and after any change to the extension's UI.

| Layer | Command | What it covers |
|---|---|---|
| Daemon | `cargo test` | Player selection, MPRIS following, LRC parsing, LRCLIB client, caches, config, every D-Bus interface against `contracts/*.xml`. Integration tests run on a private `dbus-daemon` with fake players and a local LRCLIB stub; nothing touches the real session or the network. |
| Extension logic | `cd extension && npm test` | Pure modules without `gi://` imports: position extrapolation, lyric line lookup, time and clock formatting, the hover state machine, settings parsing, colors, progress math. |
| UI | `tools/devshell/` and the checklist below | What the notch looks like and how it behaves inside a real GNOME Shell. |

`npm run check` (types and the contract check) and `npm run lint` also run in
CI.

## The devshell

`tools/devshell/run.sh` starts a headless GNOME Shell 46 with Nokta in it,
fully isolated from your session:

- its own session bus (a bare `dbus-daemon` that cannot start system
  services), so it never sees your players or your running `noktad`;
- temporary `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and
  `XDG_RUNTIME_DIR` under `build/devshell/`;
- GSettings in a keyfile there instead of dconf, so your settings are never
  read or written;
- a fake MPRIS player (`fake-player.js`, one 200 s track with a generated
  cover) and a local LRCLIB stand-in that always answers with
  `lyrics.json`.

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
tools/devshell/player.sh Playing|Paused|Stopped
tools/devshell/stop.sh
```

`run.sh --no-daemon` starts without `noktad`, `--no-player` without the fake
player. Logs of every process are in `build/devshell/*.log`; the shell's is
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
      changing the primary one, keeps the notch centered on the primary
      monitor.
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
