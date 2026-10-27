# Nokta design: focus timer

Status: approved (Ren asked for a small everyday feature built to Claude's
recommendation)
Date: 2026-10-28
Scope: a new `timer` feature on both sides, a new `io.nokta.Timer1`
interface, a `[timer]` table in the config and the settings window.

## 1. Goal

A focus timer (Pomodoro style) that lives in the notch: start a focus
session in one click, see the time left at a glance without opening
anything, and be told when it ends. A short break follows on its own.

### Success criteria

1. Quick Settings has a **Focus** toggle. Clicking it starts a focus session
   of `focus_minutes` (25) or stops the running timer. Its menu has Start
   focus, Start break, Pause or Resume, and Stop. Its subtitle shows the
   state: `25 min`, `18 min left`, `Break, 3 min left`, `Paused, 12 min left`.
2. While a timer runs, the notch shows the time left (`18:42`):
   - idle (no player): in place of the clock;
   - collapsed (a player): in place of the equalizer.
   The expanded media view does not change. A paused timer is drawn at half
   opacity and does not count down.
3. When focus ends, the notch shows an alert ("Focus done, 5 min break") and
   the break starts on its own, unless `break_minutes` is 0. When a break
   ends the alert says "Break over" and the timer stops. With `sound` on,
   GNOME's "complete" theme sound plays.
4. The timer keeps running when the screen locks, the extension is
   disabled, or GNOME Shell restarts: it lives in `noktad`.
5. Lengths and sound can be changed in the settings window and in
   `config.toml`.

## 2. Why the daemon owns it

GNOME disables extensions on the lock screen, so a timer in the extension
would reset each time the screen locks. In `noktad` it survives that, and
it is reused as is when Nokta comes to other systems.

## 3. Contract: `io.nokta.Timer1` at `/io/nokta/Timer`

| Member | Type | Meaning |
|---|---|---|
| `State` | `s` | `idle`, `running` or `paused` |
| `Phase` | `s` | `focus` or `break`; empty when idle |
| `DurationUs` | `x` | length of the current phase |
| `RemainingUs` | `x` | time left at `TimestampUs` |
| `TimestampUs` | `x` | `CLOCK_MONOTONIC` in µs when `RemainingUs` was measured |
| `Start(phase s)` | method | starts `focus` or `break` with its configured length, replacing any running timer; `InvalidArgs` for another phase |
| `Pause()`, `Resume()`, `Stop()` | methods | do nothing when they do not apply |
| `Finished(phase s)` | signal | a phase ran to its end |

Like media positions, the daemon publishes a snapshot and the extension
counts down from it with `GLib.get_monotonic_time()`. Every change goes out
in one `PropertiesChanged`.

`io.nokta.Settings1` gains a `Timer` (`a{sv}`) property and `Set` accepts
the table `timer`. Both are additions, so `ApiVersion` stays 1.

## 4. Config

```toml
[timer]
focus_minutes = 25   # 1 to 180
break_minutes = 5    # 0 to 60; 0 means no break after focus
sound = true         # play a sound when a phase ends
```

A phase takes its length when it starts; changing the config does not
change a running phase.

## 5. Daemon

- `features/timer/logic.rs`: a pure `Timer` (idle, running until a
  monotonic deadline, or paused with time left). Every method takes `now`,
  so the tests need no clock.
- `features/timer/service.rs`: one task owns the `Timer`, takes commands
  from a channel and sleeps until the deadline, so nothing polls. It reads
  lengths through a function, so tests use milliseconds. On the deadline it
  emits `Finished` and starts the break when focus ended.
- `features/timer/dbus.rs`: serves `Timer1`.
- `timer` depends on no other feature; `app` passes it the lengths from
  `settings`.

## 6. Extension

- `features/timer/logic/`: `remainingAt(snapshot, now)`,
  `formatRemaining(us)` (`m:ss`, `h:mm:ss` from an hour), the toggle's
  subtitle, and the alert text. Tested with Node.
- `features/timer/client.ts`: the `Timer1` proxy, like the other clients.
- `features/timer/toggle.ts`: the Quick Settings indicator and menu toggle,
  added in `enable()` and destroyed in `disable()`.
- The notch: a timer label in the idle and in the collapsed view (lent the
  equalizer's place). One timeout, set for when the shown second changes,
  runs only while a timer runs.
- `Finished` shows an alert through the OSD row, like device alerts, for
  `alert_duration_ms`.

## 7. Settings window

The Behavior page gets a "Focus timer" group: focus length, break length,
and the sound switch.

## 8. Testing

- Rust: `logic.rs` unit tests (start, pause, resume, stop, expiry, snapshot
  values), service tests with millisecond lengths (finish, automatic break,
  no break with 0, pause stops the deadline), the D-Bus test against the
  contract, and the config tests for the new table.
- Node: the logic module.
- The devshell: start, pause and stop through D-Bus and the toggle, with
  screenshots of the idle and collapsed notch and the alert.
- `smoke.sh`: a started focus timer shows `m:ss` in the idle notch, on
  every GNOME version in CI.

## 9. Out of scope

Statistics or history, long breaks after four sessions, Do Not Disturb
while focusing, a keyboard shortcut. They can come later without changing
`Timer1`.
