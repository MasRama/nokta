# Nokta design: device alerts

Status: approved
Date: 2026-10-27
Scope: Linux with UPower and BlueZ, GNOME Shell 46. Builds on the OSD and
multi-monitor designs; everything not named here is unchanged.

## 1. Goal

The notch briefly shows when a Bluetooth audio device connects or
disconnects, when the charger is plugged in or out, when the battery gets
low, and when it is full.

### Success criteria

1. Connecting earbuds shows their name and, when the device reports it,
   their battery, within 2 s of the connection.
2. Plugging and unplugging the charger shows `Charging` or `On battery` with
   the battery percentage.
3. Discharging past 20 % shows `Battery low` once, past 10 % shows
   `Battery critical` once, in red. Each fires again only after the battery
   was charged above its threshold.
4. Reaching full charge while plugged in shows `Fully charged` once.
5. Nothing is shown for the state found at startup.
6. The daemon never polls; without UPower, BlueZ or a system bus it runs as
   before and only logs it.

## 2. Architecture

A new daemon feature `devices` watches the system bus and emits a signal; a
new extension feature `devices` turns it into an alert in the notch.

```
UPower ─┐  system bus
BlueZ  ─┴─▶ noktad features/devices ──io.nokta.Devices1.Alert──▶ extension features/devices
                                                                     │
                                                    Session routes it to the focused notch
```

Daemon files (`core/src/features/devices/`):

| File | Purpose |
|---|---|
| `mod.rs` | Public boundary |
| `rules.rs` | Pure state machines: battery and Bluetooth transitions to alerts |
| `upower.rs` | UPower proxies, battery task |
| `bluez.rs` | BlueZ object manager and properties, Bluetooth task |
| `watcher.rs` | Starts both tasks, merges their alerts |
| `dbus.rs` | `io.nokta.Devices1` |
| `tests.rs` | Rule tests |

The system bus is `zbus`'s default (`DBUS_SYSTEM_BUS_ADDRESS` or the
standard socket). `RunOptions` gains `system_bus_address` so integration
tests use a private bus for both.

## 3. Contract: `io.nokta.Devices1` at `/io/nokta/Devices`

| Member | Kind | Type | Meaning |
|---|---|---|---|
| `Alert` | signal | `kind s, name s, percentage i` | Something happened |

`kind` is one of `bluetooth-connected`, `bluetooth-disconnected`,
`charger-plugged`, `charger-unplugged`, `battery-low`, `battery-critical`,
`battery-full`. `name` is the Bluetooth device's alias, empty for battery
alerts. `percentage` is 0–100, or -1 when unknown.

The extension ignores kinds it does not know, so new kinds can be added to
`Devices1` without breaking older extensions. `ApiVersion` stays 1: the
interface is new, nothing existing changes. `check-contracts` learns to
check signals (`DEVICES_SIGNALS` in `contracts.ts`).

## 4. Rules

### 4.1 Battery (UPower)

Sources: `org.freedesktop.UPower.OnBattery` and, on the display device
`/org/freedesktop/UPower/devices/DisplayDevice`, `IsPresent`, `State` and
`Percentage`. Any change of these re-evaluates one sample
`{ present, on_battery, full (State == 4), percentage }`.

- First sample: remembered, no alert. Thresholds already passed count as
  sent.
- No battery present: no alerts.
- `on_battery` changes: `charger-plugged` or `charger-unplugged` with the
  percentage.
- On battery and percentage ≤ 10, not sent yet: `battery-critical` (also
  marks low as sent). Else ≤ 20, not sent yet: `battery-low`.
- Percentage above a threshold re-arms it.
- On AC and `full` becomes true: `battery-full`, once until `full` is false
  again.

Several alerts from one sample are sent in that order; the notch shows the
last one.

### 4.2 Bluetooth (BlueZ)

Devices are `org.bluez.Device1` objects; audio devices have an `Icon`
starting with `audio-` or a `Class` whose major class is Audio/Video
(`(class >> 8) & 0x1f == 4`). Only audio devices raise alerts.

- Startup snapshot (`GetManagedObjects`) and devices added later: remembered,
  no alert.
- `Connected` false → true: if the battery (`org.bluez.Battery1.Percentage`)
  is known, `bluetooth-connected` at once; otherwise wait for it at most 2 s
  and send the alert when it arrives or when the wait ends (percentage -1).
- `Connected` true → false: `bluetooth-disconnected` (percentage -1), any
  wait is cancelled, the battery is forgotten.
- `Alias` changes update the name.

The 2 s wait is a single timer per connection, not polling.

## 5. Extension

- `features/devices/client.ts` subscribes to `Alert`; `logic/alert.ts`
  turns `(kind, name, percentage)` into `{ icon, title, detail, urgent }`:

| kind | icon | title | detail |
|---|---|---|---|
| bluetooth-connected | `audio-headphones-symbolic` | name | `82%`, or `Connected` without a battery |
| bluetooth-disconnected | `audio-headphones-symbolic` | name | `Disconnected` |
| charger-plugged | `battery-good-charging-symbolic` | `Charging` | `76%` |
| charger-unplugged | `battery-good-symbolic` | `On battery` | `76%` |
| battery-low | `battery-low-symbolic` | `Battery low` | `20%` |
| battery-critical | `battery-caution-symbolic` | `Battery critical` | `9%` (urgent) |
| battery-full | `battery-full-charged-symbolic` | `Fully charged` | `100%` |

  An empty name shows `Bluetooth device`. Unknown kinds return nothing.
- `devices` and `osd` stay independent features; `extension.ts` maps an alert
  to the OSD row (`OsdContent` gains an optional right-hand `detail` and an
  `urgent` flag that colors icon and text red, `#ff453a`).
- The alert shows in the focused monitor's notch (multi-monitor routing with
  `-1`) for `alert_duration_ms`. If that notch is hidden or the screen is
  locked, it is skipped.

## 6. Config

```toml
[behavior]
device_alerts = true       # show Bluetooth, charger and battery alerts in the notch
alert_duration_ms = 3000   # how long an alert stays
```

`alert_duration_ms` is 500–15000.

## 7. Testing

- Daemon unit tests for every rule in 4.1 and 4.2 (no bus, no timers).
- Daemon integration test on a private bus with a fake UPower and a fake
  BlueZ: a charger change and a Bluetooth connection arrive as `Alert`
  signals; the contract test covers `Devices1`.
- Extension: `logic/alert.ts` for every row of the table, settings parsing.
- Devshell: `fake-devices.js` serves UPower and BlueZ on the devshell bus
  (the daemon's system bus there), `device.sh` drives it; each alert is
  checked by screenshot.
- Real session: real earbuds, real charger.

## 8. Out of scope

Non-audio Bluetooth devices, Wi-Fi alerts, battery of peripherals other than
Bluetooth audio, a battery indicator in the idle notch.
