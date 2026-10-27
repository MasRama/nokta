# Nokta design: settings window, transparency and clock format

Status: approved
Date: 2026-10-27
Scope: GNOME Shell 46. Builds on the earlier designs; everything not named
here is unchanged.

## 1. Goal

Every Nokta setting can be changed from a settings window, without editing
`config.toml` by hand. The notch gets a few new knobs: background
transparency, an accent color, and a clock that can be 24-hour, 12-hour or
follow GNOME, or be hidden.

### Success criteria

1. The Settings button of Nokta in the Extensions app (or
   `gnome-extensions prefs nokta@nokta.io`) opens a window with every key of
   `config.toml`, grouped by topic.
2. A change in the window shows in the notch within a second, and is saved in
   `config.toml` with its comments kept.
3. A value the daemon rejects is not saved; the window says why and shows the
   saved value again.
4. A change made by editing `config.toml` shows in an open window.
5. `clock_format = "24h"` shows 5 pm as `17:00`.
6. `background_opacity = 0.6` makes the notch background see-through while
   its text, icons and bars stay solid.
7. Without `noktad` the window says so and changes nothing.

## 2. Architecture

`config.toml` stays the only place settings live. The daemon owns it: the
window asks the daemon to change a value, the daemon checks and writes the
file, and the existing file watcher publishes the new value to the notch and
to the window.

```
settings window ──Settings1.Set(table, key, value)──▶ noktad ──writes──▶ config.toml
      ▲                                                                      │
      └──── Appearance / Behavior / Lyrics changed ◀── watcher reloads ◀─────┘
```

The window is `prefs.js`, which GNOME runs in its own process
(`org.gnome.Shell.Extensions`), never inside GNOME Shell. It uses GTK 4 and
libadwaita. In the source it is `extension/src/prefs.ts` plus
`extension/src/prefs/`; the shell side never imports them, and they never
import shell-only modules (`St`, `Clutter`, `Main`).

## 3. Contract: additions to `io.nokta.Settings1`

Additions only, so the interface stays `...1` and older extensions keep
working.

| Member | Kind | Type | Meaning |
|---|---|---|---|
| `Lyrics` | property | `a{sv}` | The `[lyrics]` table, like `Appearance` and `Behavior` |
| `Set` | method | `table s, key s, value v` | Change one key and save it |
| `Reset` | method | none | Replace `config.toml` with the commented default |

`Set` fails with `org.freedesktop.DBus.Error.InvalidArgs` and a readable
message for an unknown table or key, a value of the wrong type, or a value
the config validation rejects (for example `height = 5`). Integers may be
sent as any D-Bus integer type or a whole double; floats as a double or an
integer. Nothing is written when it fails.

## 4. Writing `config.toml`

- The daemon edits the document with `toml_edit`, which keeps comments,
  order and formatting. The value's trailing comment stays.
- A key that is missing (deleted by the user) is added to its table; a
  missing table is added at the end.
- The edited text goes through the same `parse()` and validation as a
  loaded file before it is written. When the file is already broken, `Set`
  fails with that error.
- The file is written to a temporary file in the same directory and renamed,
  so a reader never sees half a file. The watcher sees it and reloads.
- `Set` and `Reset` are serialized; two quick changes never lose one.

`toml_edit` is part of the `toml` project and already in `Cargo.lock`; the
locked stack row for config becomes "`serde`, `toml` and `toml_edit`".

## 5. New settings

```toml
[appearance]
background_opacity = 1.0  # 0.0 = see-through, 1.0 = solid; text and icons stay solid
accent = "#ffffff"        # progress bar, equalizer and OSD bar (the cover color wins when use_album_accent is on)

[behavior]
show_clock = true         # the time in the notch while nothing plays
clock_format = "system"   # "24h", "12h", or "system" to follow GNOME's setting
```

- `background_opacity` is 0.0–1.0 and applies to the body and the ears.
- `accent` replaces the foreground as the fallback for the cover color and
  colors the OSD bar. Its default is the old foreground, so nothing looks
  different until it is changed.
- `clock_format` is checked by the daemon (one of the three words). The
  extension treats an unknown word as `system`.
- `show_clock = false` leaves the idle notch empty and stops its clock.

The extension's settings parser accepts any string for keys whose default
is not a color; colors still must be `#rrggbb`.

## 6. The window

Two pages; each row is built from one list in
`features/settings/logic/schema.ts` (table, key, title, subtitle, kind and
limits), so a new setting is one line there. A Node test checks that the
list and the parser's defaults name exactly the same keys.

**Appearance**
- Colors: background (color button), background opacity (slider 0–100 %),
  text color, accent color, use the cover's color.
- Size: height, idle width, playing width, expanded width and height, OSD
  width.
- Shape: corner radius, ear radius.
- Motion: animation speed.

**Behavior**
- Notch: on every monitor, open delay, close delay.
- Clock: show the clock, format (follow GNOME / 24-hour / 12-hour), move
  GNOME's clock to the right.
- Music: show lyrics, look up lyrics online (says what is sent).
- System popups: show volume and brightness in the notch, how long, Caps Lock.
- Device alerts: show them, how long.
- Reset all settings (asks first), open `config.toml`.

Behaviour:
- Rows show the daemon's values and follow its `PropertiesChanged`.
- A change is sent with `Set` after 250 ms without further change, so
  dragging a slider sends one value. A failure shows a toast with the
  daemon's message and puts the row back to the saved value.
- Without the daemon (it is D-Bus activatable, so this means it is not
  installed or fails), a banner says so and the rows are insensitive.

## 7. Testing

- Daemon unit tests for the document edit: comments kept, value replaced,
  missing key and table added, unknown key, wrong type, integer and float
  coercion, invalid value, broken file.
- Daemon integration test: `Set` on the bus changes `config.toml` and the
  published property; a bad `Set` changes nothing; `Reset` writes the
  default. The contract test covers the new members.
- Extension: schema matches defaults, new keys parse, clock format choice,
  background with opacity.
- Devshell: transparency, accent, 24-hour clock and hidden clock by editing
  the config; the window opened in the devshell's display and used to change
  a setting.
- Real session: open the window from the Extensions app.

## 8. Out of scope

Per-monitor settings, themes or presets, fonts, import and export.
