# Nokta design: GNOME Shell 46 to 51

Status: approved
Date: 2026-10-28
Scope: the GNOME Shell extension. Builds on the earlier designs; the D-Bus
contract does not change. The daemon only learns to start on a system
without CA certificates, which the CI containers found.

## 1. Goal

Nokta runs on every GNOME Shell from 46 to 51, so it works on the Linux
distributions people use today, and it can be published on
extensions.gnome.org (EGO).

| GNOME | Distributions (October 2026) |
|---|---|
| 46 | Ubuntu 24.04 LTS, Zorin OS 18, Linux Mint based on 24.04 |
| 47 | none still supported (Fedora 41, Ubuntu 24.10 ended) |
| 48 | Debian 13 |
| 49 | Fedora 43, RHEL and AlmaLinux 10.2, Ubuntu 25.10 |
| 50 | Ubuntu 26.04 LTS, Fedora 44 |
| 51 | Fedora 45, Ubuntu 26.10, Arch and other rolling ones |

GNOME 45 is left out: every distribution that shipped it has ended, and its
libadwaita (1.4) lacks the dialog the settings window uses.

### Success criteria

1. `metadata.json` lists 46 to 51.
2. For each of 46, 48, 49, 50 and 51 a CI job starts that GNOME Shell
   headless with the extension and `noktad`, and checks: the extension is
   active with no `JS ERROR` or `JS WARNING` from Nokta, the idle clock, a
   playing track, an OSD request drawn in the notch, and the settings window
   opening. Screenshots are kept as job artifacts.
3. 47 has no supported distribution to test on; every code path it takes is
   also taken by 46 or 48 (see 2), and the README says it is untested.
4. On 46 nothing looks or behaves differently from v0.2.0.

## 2. What differs between versions

Found by reading GNOME Shell's sources at 46.10, 47.10, 48.8, 49.10, 50.6
and 51.1.

| Change | Versions | What Nokta does |
|---|---|---|
| `St.BoxLayout.vertical` deprecated for `orientation` | `orientation` from 48; `vertical` removed in 51 | A helper sets `orientation` when the class has it, else `vertical` |
| `Clutter.get_default_backend()` deprecated | the shell uses `actor.get_context().get_backend()` from 48 | A helper uses the stage's context when it has one, else the default backend (Caps Lock keymap) |
| `osdWindowManager.show(monitor, icon, label, level, max)` | up to 48 | Hooked as today |
| `osdWindowManager.show(icon, label, levels)`, `showOne(...)`, `showAll(...)` | from 49 | `show` and `showAll` are hooked (`showOne` calls `show`) |
| `fillPreferencesWindow` may be async | from 47 | Nothing; the synchronous one still works |

Everything else Nokta uses (`Main.layoutManager.addTopChrome`,
`monitors-changed`, the panel's `_centerBox` and `_rightBox`, the date menu,
`sessionMode.isLocked`, `ExtensionState.ACTIVE`, the keymap's
`state-changed`) is the same in all six.

Version checks are feature checks (does the object have this property or
method), never version-number checks, so a distribution's patched shell
still takes the right path.

### 2.1 The OSD from GNOME 49

`show(icon, label, levels)` takes a map from monitor index to
`{ level, maxLevel }`; a monitor that is missing has its popup cancelled.
Brightness sends one entry per screen with a backlight, volume calls
`showAll`, and the `ShowOSD` D-Bus method calls `showOne` or `showAll`.

A pure function `fromLevels(levels, preferred)` in `features/osd/logic/`
turns the map into today's request:

- no entry: nothing to show (`null`);
- one entry: that monitor, its level and maximum;
- several entries: monitor `-1` (routing picks the focused one), with the
  level of `preferred` (the focused monitor) when it has an entry, else of
  the lowest monitor index.

When the notch cannot draw it, GNOME's own popup is shown on the routed
monitor by calling the original `show` with only that monitor's entry.
`showAll` is a request for monitor `-1`.

## 3. Testing

- Node tests for `fromLevels` (none, one, several with and without the
  preferred monitor, missing maximum).
- `tools/devshell/smoke.sh`, run inside the devshell, makes the checks of
  success criterion 2 with `shell_eval`, `osd.sh`, `player.sh` and
  `prefs.sh`, and saves screenshots. It exits non-zero on the first failure.
- A CI workflow builds `noktad` and the extension once, then runs
  `smoke.sh` in a container per version: `ubuntu:24.04` (46),
  `debian:trixie` (48), `fedora:43` (49), `fedora:44` (50) and `fedora:45`
  (51), and uploads `build/shots` and the logs.
- The devshell on Ren's machine (46) runs the full manual checklist once.

## 4. extensions.gnome.org

- The packed zip is already what EGO takes; `shell-version` lists 46 to 51.
- The description says the daemon is needed and where to get it. The
  settings window's banner says the same when the daemon is missing, with a
  button that opens the install instructions.
- Uploading needs Ren's EGO account; the review checklist (no
  minification, everything undone in `disable()`, no `unlock-dialog`
  session mode, monkey-patches restored) is in `docs/ego.md`.

## 5. Out of scope

GNOME 45 and older, packages for distributions (deb, rpm, AUR), other
architectures for the prebuilt daemon.
