# Nokta

An open-source dynamic island for the desktop. A black notch sits on the top
edge of the screen and shows the song that is playing. Hover over it and it
opens with the cover, controls, a seek bar and the current line of the
song's synced lyrics. When you change the volume or the brightness, or turn
Caps Lock on or off, the notch shows it instead of the system popup. It also
tells you when your Bluetooth headphones connect (with their battery), when
the charger is plugged in or out, when the battery is low and when it is
full. A focus timer from Quick Settings counts down in the notch and
starts a short break when the session ends. Every monitor has its own notch,
and these messages show on the monitor you are working on.

![The notch opened while a song plays](docs/images/expanded.png)

![The notch closed while a song plays](docs/images/collapsed.png)

![The notch showing the volume](docs/images/osd.png)

![The notch showing connected earbuds and their battery](docs/images/device-alert.png)

![The notch counting down a focus session while a song plays](docs/images/focus-timer.png)

Nokta has two parts:

- **`noktad`**, a small Rust daemon that follows your media players (MPRIS),
  fetches lyrics, watches the battery (UPower) and Bluetooth (BlueZ), runs
  the focus timer, and reads your settings.
- **A frontend** that draws the notch and talks to the daemon. On Linux it
  is a GNOME Shell extension, and they talk over D-Bus.

The daemon does the work so the shell stays fast. It uses no CPU while
nothing plays and about 10 MB of memory.

## Platforms

| Platform | Status |
|---|---|
| Linux, GNOME 46 to 51 | Works (47 is untested: no supported distribution ships it) |
| Linux, KDE Plasma, Hyprland, Sway | Planned |
| Windows | Planned: the daemon's core builds and passes its tests there |
| macOS | Planned: the daemon's core builds and passes its tests there |

The plan is one daemon for every platform, with a small frontend for each
desktop that draws the notch. Today the only frontend, and the only media
and device sources, are on Linux. CI builds and tests the rest of the daemon
on macOS and Windows on every change.

## Requirements

- GNOME Shell 46 to 51: Ubuntu 24.04 and 26.04, Zorin OS 18, Debian 13,
  Fedora 43 to 45, RHEL and AlmaLinux 10, Arch and others. GNOME 45 and
  older are not supported.
- An x86_64 machine for the prebuilt daemon. On other architectures,
  [build from source](#build-from-source).
- A music player that supports MPRIS. Spotify, Rhythmbox, Lollypop, VLC,
  mpv (with `mpv-mpris`), Firefox and Chromium all do.

## Install

1. Download `noktad-<version>-x86_64-linux.tar.gz` from the
   [latest release](https://github.com/MasRama/nokta/releases/latest).
2. Unpack it and run the installer:

   ```sh
   tar xf noktad-*-x86_64-linux.tar.gz
   cd noktad-*-x86_64-linux
   ./install.sh
   ```

   It installs into your home directory only and never uses `sudo`:
   `~/.local/bin/noktad`, a systemd user unit, a D-Bus activation file and
   the GNOME extension.
3. Log out and log back in. GNOME on Wayland loads new extensions only at
   login.
4. Turn the extension on:

   ```sh
   gnome-extensions enable nokta@nokta.io
   ```

The daemon starts by itself the first time the extension needs it.

**Just Perfection users:** Nokta normally moves the GNOME clock to the right
side of the top bar so the notch does not cover it. When Just Perfection is
enabled, Nokta leaves the clock alone so the two extensions don't fight over
it. Open Just Perfection's settings and set **Clock Menu Position** to
**Right** instead.

## Settings

Open the settings window with the Settings button of Nokta in the
Extensions app, or with `gnome-extensions prefs nokta@nokta.io`. It has every
setting below: colors and background transparency, sizes, the clock format
(24-hour, 12-hour or GNOME's), lyrics, popups, device alerts and the focus
timer. A change
shows in the notch right away.

The window saves to `~/.config/nokta/config.toml`, and you can edit that file
by hand too; your comments are kept either way. The daemon writes a commented
copy with the defaults on first start. Changes apply as soon as you save the
file. If the file has a mistake, Nokta keeps the last working settings and
logs the line and column of the error (`journalctl --user -u nokta`); the
window then says what to fix before it saves anything.

### `[appearance]`

| Key | Default | What it does |
|---|---|---|
| `height` | `32` | Height of the closed notch in pixels |
| `idle_width` | `180` | Width of the closed notch when nothing plays |
| `playing_width` | `260` | Width of the closed notch while music plays |
| `expanded_width` | `420` | Width of the open notch |
| `expanded_height` | `150` | Height of the open notch |
| `corner_radius` | `14` | Radius of the bottom corners |
| `ear_radius` | `8` | Radius of the inward curves where the notch meets the top edge |
| `background` | `"#000000"` | Notch color |
| `background_opacity` | `1.0` | `0.0` makes the notch background see-through, `1.0` solid; text and icons stay solid |
| `foreground` | `"#ffffff"` | Text and icon color |
| `accent` | `"#ffffff"` | Color of the seek bar, the equalizer and the volume bar when the cover's color is not used |
| `use_album_accent` | `true` | Color the seek bar and the equalizer with the cover's color |
| `animation_speed` | `1.0` | `0.5` is twice as fast, `2.0` twice as slow |
| `osd_width` | `300` | Width of the notch while it shows volume, brightness or Caps Lock |

### `[behavior]`

| Key | Default | What it does |
|---|---|---|
| `open_delay_ms` | `120` | How long the pointer must rest on the notch before it opens |
| `close_delay_ms` | `300` | How long the notch stays open after the pointer leaves |
| `move_clock` | `true` | Move the GNOME clock to the right side of the top bar |
| `show_lyrics` | `true` | Show the current lyric line in the open notch |
| `replace_osd` | `true` | Show volume, brightness and other system popups in the notch instead of GNOME's popup |
| `osd_duration_ms` | `1500` | How long the notch shows the volume or brightness after the last change |
| `show_caps_lock` | `true` | Show a message in the notch when Caps Lock turns on or off |
| `all_monitors` | `true` | Show a notch on every monitor; `false` shows it only on the primary monitor |
| `device_alerts` | `true` | Show Bluetooth audio, charger and battery alerts in the notch |
| `alert_duration_ms` | `3000` | How long a device alert stays |
| `show_clock` | `true` | Show the time in the notch while nothing plays |
| `clock_format` | `"system"` | `"24h"` (17:00), `"12h"` (5:00), or `"system"` to follow GNOME's setting |

### `[lyrics]`

| Key | Default | What it does |
|---|---|---|
| `enabled` | `true` | Look up lyrics on lrclib.net |

### `[timer]`

Start the timer with the **Focus** toggle in Quick Settings; its menu also
starts a break, pauses and stops. The timer runs in the daemon, so it keeps
going while the screen is locked.

| Key | Default | What it does |
|---|---|---|
| `focus_minutes` | `25` | Length of a focus session, 1 to 180 |
| `break_minutes` | `5` | Break that starts after a focus session, 0 to 60; `0` means no break |
| `sound` | `true` | Play a sound when a focus session or a break ends |

## Privacy

To find lyrics, `noktad` sends the artist, title, album and length of the
song that is playing to [LRCLIB](https://lrclib.net), a free, open lyrics
database. It sends nothing else, and nothing at all when lyrics are turned
off:

```toml
[lyrics]
enabled = false
```

Cover art that a player offers as a web address is downloaded to
`~/.cache/nokta/art/`. Lyrics are cached in `~/.cache/nokta/lyrics/`.

## Uninstall

From the unpacked release folder:

```sh
./uninstall.sh          # keeps ~/.config/nokta and ~/.cache/nokta
./uninstall.sh --purge  # removes them too
```

## Build from source

You need Rust (stable), Node.js 22.13 or newer, and `gnome-extensions`
(part of GNOME Shell).

```sh
git clone https://github.com/MasRama/nokta.git
cd nokta
cargo build --release
(cd extension && npm ci && npm run pack)
packaging/install.sh
gnome-extensions install --force build/nokta@nokta.io.shell-extension.zip
```

`install.sh` finds the binary in `target/release` when it runs from a
checkout. Then log out, log back in and enable the extension as above.
`docs/testing.md` shows how to try changes in a throwaway GNOME Shell
without touching your session.

## Troubleshooting

- **The notch shows only a clock while music plays.** Check that the daemon
  runs: `systemctl --user status nokta`. Its log is in
  `journalctl --user -u nokta`.
- **No lyrics.** LRCLIB does not know every song, and only time-synced lyrics
  are shown. A song that was not found is not looked up again for 7 days.
  Songs played on YouTube in a browser work too: Nokta drops "(Official
  Music Video)" and the like and reads the artist from the title.
- **Your own lyrics.** Put a synced `.lrc` file next to a local music file
  with the same name (`Song.flac` and `Song.lrc`), or name it
  `Artist - Title.lrc` and put it in `~/.local/share/nokta/lyrics/`. Your
  files always win over LRCLIB and show the next time the song plays.
- **The extension does not show up in `gnome-extensions list`.** Log out and
  back in after installing.

## Contributing

Bug reports and pull requests are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) first, and
[ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together.

## License

[GPL-3.0-or-later](LICENSE)
