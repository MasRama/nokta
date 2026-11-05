# Writing a Nokta plugin

A plugin puts your own card in the notch: a build that is running, a site
that went down, the glasses of water you drank. It is a folder with a
`plugin.toml` and a program in any language. Nokta runs the program, and the
program prints what the card shows as JSON. This page is version 1 of that
contract (`api = 1`).

Plugins run as you, with your files and your network. Install only ones you
trust; a plugin you install starts off until you turn it on.

Three examples to copy are in [`examples/plugins`](../examples/plugins):
`hello` (a card with a list and options), `site-status` (alerts and a badge)
and `water` (a plugin that keeps running and hears its buttons).

## Install, turn on, try

- Settings → Plugins → Added → **Add from Folder…**, or
  `nokta plugin install path/to/folder`.
- From the [catalog](#share-it-in-the-catalog): Settings → Plugins →
  Catalog → **Browse**, or `nokta plugin catalog` and then
  `nokta plugin install <id>`. `nokta plugin update <id>` installs the
  catalog's newer version and keeps its switch and options.
- Turn it on with its switch, or `nokta plugin enable <id>`.
- `nokta plugin run <id>` runs it now; `nokta plugin list` says what each
  one is doing and why one failed.

Nokta copies the folder into its plugins folder
(`~/.local/share/nokta/plugins` on Linux, `%APPDATA%\nokta\plugins` on
Windows, `~/Library/Application Support/nokta/plugins` on macOS). While you
write a plugin you can work right in there: Nokta notices a new folder and a
changed `plugin.toml` without a restart.

## plugin.toml

```toml
api = 1                       # this contract
id = "site-status"            # 2 to 40 of a-z, 0-9 and -; the folder's name too
name = "Site status"
description = "Checks that a website answers"
version = "1.0.0"
author = "You"
homepage = "https://example.com/site-status"
icon = "nokta-link"           # optional: one of Nokta's icons or the system's

[run]
command = ["./check.sh"]      # Linux and macOS; ./ is the plugin's folder
windows = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "check.ps1"]
every = 120                   # seconds between runs, 5 to 86400; 0 keeps it running
timeout = 15                  # seconds a run may take, 1 to 120 (20 if left out)

[[options]]                   # up to 12, shown in the settings window
key = "url"                   # a-z, 0-9 and _; the program gets NOKTA_OPTION_URL
title = "Address"
subtitle = "The page to check"
type = "text"                 # text, bool, int (with min and max) or choice (with choices)
default = "https://example.com"
```

A plugin without a command for this system is listed as not running here.

## What the program gets

Its folder as the working directory, and in its environment:

| Variable | What |
| --- | --- |
| `NOKTA_API` | `1` |
| `NOKTA_PLUGIN` | its id |
| `NOKTA_PLUGIN_DIR` | its folder; replaced when the plugin is updated |
| `NOKTA_PLUGIN_DATA` | a folder of its own for what it keeps; it outlives updates and goes when the plugin is removed |
| `NOKTA_OPTION_<KEY>` | each option: the text, `true` or `false`, or the number |
| `NOKTA_ACTION` | the button pressed, for a run one asked for |

## What it prints

One JSON object: the whole of its output, or its last line that is one (so a
line of logging before it is fine). Anything it writes to stderr shows in
the settings window when it fails.

```json
{
  "title": "3 open pull requests",
  "detail": "nokta · 1 needs your review",
  "icon": "nokta-link",
  "tone": "blue",
  "progress": 0.4,
  "badge": "3",
  "items": [
    { "title": "Fix the shelf", "detail": "#142", "open": "https://github.com/..." }
  ],
  "actions": [
    { "label": "Open", "open": "https://github.com/pulls" },
    { "label": "Refresh", "run": "refresh" }
  ],
  "alert": { "id": "pr-142", "title": "Review asked", "detail": "#142", "important": false }
}
```

Every key is optional.

- `title` and `detail`: the row in the open notch's home (80 and 120
  characters). A card without a title shows no row.
- `icon`: an icon name; the plugin's own, then Nokta's plugin icon, when left
  out.
- `tone`: `red`, `orange`, `amber`, `yellow`, `green`, `teal`, `blue`,
  `indigo`, `purple`, `pink` or `gray`.
- `progress`: 0 to 1 draws a thin bar under the row.
- `badge`: up to 8 characters with the icon in the closed notch, after the
  focus timer, the clocks, live activities and a meeting about to start.
- `items`: up to 8. A row with items opens them as a list.
- `actions`: up to 2 buttons on the row. `open` opens an `http` or `https`
  address; `run` (letters, digits, `-` and `_`, up to 32) runs the plugin
  again at once with `NOKTA_ACTION` set to it.
- `alert`: the notch shows it once for each `id` (the title when there is
  none). An `important` one also shows over a fullscreen app when
  `fullscreen_alerts` is `important`.
- `hidden: true`: no row and no badge, but an alert still shows.

Links open only `http` and `https`; anything else is left out. Output past
64 KiB, or a run longer than `timeout`, counts as a failure.

## A plugin that keeps running

With `every = 0` Nokta starts the program once and keeps it running. It
prints one JSON object per line, a new card each time something changes, and
each button pressed reaches it as a line on its standard input:

```json
{"action": "drink"}
```

Flush after each line. If it exits, Nokta starts it again after a second,
then waiting longer each time it keeps failing.

## Share it in the catalog

The catalog is [MasRama/nokta-plugins](https://github.com/MasRama/nokta-plugins):
one folder per plugin under `plugins/`, sent as a pull request and read by
a person before it is merged. Its `catalog` branch publishes `index.json`,
which lists every file of every plugin with its size and SHA-256, and the
files themselves. Nokta asks for the catalog only when you press Browse or
run `nokta plugin catalog`. It downloads a plugin's files one by one,
installs nothing if one does not match `index.json`, and then installs the
folder as **Add from Folder…** does: off, until you turn it on.

A plugin from the catalog can also be added from a folder, so try yours
from a folder first. Settings shows **Update** when the catalog has a
newer `version` of a plugin you have with the same id.
