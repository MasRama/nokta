# Nokta device alerts Implementation Plan

**Goal:** Bluetooth audio, charger and battery alerts in the notch.

**Spec:** `docs/specs/2026-10-27-nokta-device-alerts-design.md`

**Architecture:** Daemon feature `devices` (UPower + BlueZ on the system bus, pure rules) emits `io.nokta.Devices1.Alert`; extension feature `devices` subscribes; `extension.ts` shows it through the OSD row in the focused notch.

## Global constraints

- Contracts first. No polling. Tests first. Heavy commands one at a time.
- The daemon keeps working without a system bus, UPower or BlueZ.
- `devices` and `osd` do not import each other.

## Task 1: Settings

- [ ] Rust and TS tests for `device_alerts` (true) and `alert_duration_ms` (3000, range 500–15000); implement; README table.
- [ ] Commit `feat(settings): add the device alert settings`.

## Task 2: Contract

- [ ] `contracts/io.nokta.Devices1.xml`; `contracts.ts` `PATHS.Devices1`, `DEVICES_SIGNALS`; `check-contracts.mjs` checks signals and allows interfaces without properties.
- [ ] Commit `feat(contracts): add io.nokta.Devices1 with the Alert signal`.

## Task 3: Daemon feature

- [ ] `rules.rs` with tests first: battery rules (startup, plugged/unplugged, low, critical, re-arm, full, no battery), Bluetooth rules (audio detection, connect with known battery, connect waits, battery arrives, timeout, stale timeout, disconnect, non-audio ignored, startup silent).
- [ ] `upower.rs`, `bluez.rs`, `watcher.rs`, `dbus.rs`; `RunOptions.system_bus_address`; wire in `app`.
- [ ] Integration test with fake UPower and BlueZ; contract test includes `Devices1`.
- [ ] fmt, clippy, `cargo test`. Commit `feat(devices): send Bluetooth, charger and battery alerts`.

## Task 4: Extension feature

- [ ] `logic/alert.ts` tests first, then implement; `client.ts`; `index.ts`.
- [ ] `OsdContent.detail` / `urgent`, `OsdView` right-hand detail and red tone, `OsdTimer.show(ms)`.
- [ ] `extension.ts`: attach the client, route alerts to the focused notch.
- [ ] check, lint, test. Commit `feat(devices): show device alerts in the notch`.

## Task 5: Devshell and docs

- [ ] `fake-devices.js`, `device.sh`, `run.sh` sets the daemon's system bus to the devshell bus.
- [ ] Devshell check of every alert; commit `chore(devshell): fake UPower and BlueZ`.
- [ ] README, ARCHITECTURE, testing.md, AGENTS scope `devices`; commit docs.
