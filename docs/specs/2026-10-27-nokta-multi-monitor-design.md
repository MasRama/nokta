# Nokta design: a notch on every monitor

Status: approved
Date: 2026-10-27
Scope: GNOME Shell 46. Builds on the v0.1 design and the OSD design
(`2026-10-27-nokta-v0.2-osd-design.md`); everything not named here is
unchanged.

## 1. Goal

Every monitor gets its own notch. They show the same things (clock, music,
lyrics) but open and close on their own: hovering the notch on monitor 2
opens only that one. A volume or brightness change, or Caps Lock, shows only
on the monitor the user is working on, not on all of them.

### Success criteria

1. With two monitors, each has a notch centered at its top edge; hovering one
   never opens the other.
2. Volume keys while a window on monitor 2 is focused show the OSD only in
   monitor 2's notch.
3. Brightness of the built-in screen (a request for a given monitor) shows in
   that monitor's notch.
4. A fullscreen app on one monitor hides only that monitor's notch; an OSD
   meant for that monitor uses GNOME's popup there.
5. Plugging, unplugging or changing the primary monitor rebuilds the notches
   for the new layout without errors.
6. `all_monitors = false` gives back the single notch on the primary monitor.

## 2. Which monitor is "focused"

The monitor of the focused window (`global.display.focus_window`). Without a
focused window (empty desktop) it is the monitor under the pointer
(`global.display.get_current_monitor()`). It is read when an OSD request
arrives; nothing is tracked in between.

## 3. Routing an OSD request

Input: the monitor index of the request (`-1` means "no particular
monitor"), the focused monitor, the primary monitor and the monitors that
have a notch. Output: the *wanted* monitor and the *notch* to draw in.

- wanted = the request's monitor if it is set, else the focused monitor, else
  the primary monitor.
- notch = wanted if it has a notch, else the primary monitor if it has one,
  else none.

The request is drawn in that notch when the notch is visible and the screen
is not locked. Otherwise GNOME's original `show()` gets the request with the
*wanted* monitor, so its popup appears only there. Caps Lock uses the same
routing with `-1`; when its notch cannot draw it, nothing is shown (GNOME has
no Caps Lock popup).

The hook from the OSD design changes accordingly: its handler receives the
request including the monitor index and answers either "drawn" or "send to
GNOME on monitor N". `wanted()` goes away.

## 4. Structure

The extension's `Session` splits in two:

| Part | Owns |
|---|---|
| `Session` (`extension.ts`) | daemon watch, settings, media and lyrics clients, OSD hook, Caps Lock watcher, top-bar clock, the list of notches |
| `MonitorNotch` (`monitor-notch.ts`, new) | one notch: its actor and views, `NotchMachine`, `OsdTimer`, drawn mode, hover, its progress and lyric timers |

`MonitorNotch` is composition, like `extension.ts`: it mounts the feature
views and is not a feature. The routing decision is pure and lives in
`features/osd/logic/route.ts` with Node tests.

`Session` builds one `MonitorNotch` per monitor (or only the primary with
`all_monitors = false`). On `monitors-changed`, or when `all_monitors`
changes, it destroys all of them and builds them again. Media, lyrics and
settings changes are passed to every notch.

## 5. Cost

Each collapsed notch animates its own equalizer while music plays, and each
idle notch runs its own once-a-minute clock timer. With two monitors that is
two of each. Progress and lyric timers still run only in an expanded notch,
and only one notch can be under the pointer.

## 6. Config

```toml
[behavior]
all_monitors = true      # a notch on every monitor; false = only on the primary monitor
```

Published in the existing `Behavior` table; the D-Bus contract does not
change.

## 7. Testing

- Daemon: defaults and `to_dbus` keys include `all_monitors`.
- Extension logic: every rule in section 3, settings parsing of the new key.
- Devshell with two virtual monitors (`run.sh --monitors 2`): a notch on
  each, hover opens only the hovered one, OSD with `-1` follows the pointer
  monitor (no window is focused in the devshell), OSD for a given monitor
  shows there, `all_monitors = false` leaves one notch, disable and enable
  leave nothing behind.
- Real session: OSD follows the focused window, fullscreen on one monitor,
  plugging and unplugging a monitor.

## 8. Out of scope

Different content per monitor, per-monitor sizes, choosing monitors by
connector name.
