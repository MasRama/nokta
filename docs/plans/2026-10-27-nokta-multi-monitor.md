# Nokta multi-monitor Implementation Plan

**Goal:** A notch on every monitor with its own hover; OSD and Caps Lock only on the focused monitor.

**Spec:** `docs/specs/2026-10-27-nokta-multi-monitor-design.md`

**Architecture:** `Session` keeps the shared clients and hooks; a new `MonitorNotch` per monitor owns the notch, views, state machine, OSD timer and its timers. Routing is a pure function in `features/osd/logic/route.ts`.

## Global constraints

- GNOME Shell 46 only; no polling; everything created in `enable()` is undone in `disable()`, and everything a `MonitorNotch` creates is undone in its `destroy()`.
- Tests first for logic. Heavy commands one at a time.
- Default `all_monitors = true`.

## Task 1: `all_monitors` setting

- [ ] Rust: extend `defaults_match_spec` and `behavior_to_dbus_has_all_keys`; fail; add the field, default, `to_dbus` entry and the commented line in `default_config.toml`; `cargo test` passes.
- [ ] Extension: extend the settings test; fail; add `allMonitors` to `Behavior`; `npm test` passes.
- [ ] README config table.
- [ ] Commit `feat(settings): add the all_monitors setting`.

## Task 2: OSD routing logic

- [ ] Tests for `routeOsd({ requested, focused, primary, notches })` → `{ monitor, notch }`: explicit monitor with a notch, `-1` to the focused monitor, focused without a notch to the primary, explicit without a notch keeps `monitor` and draws on the primary, invalid focus to the primary, no notches gives `notch: null`.
- [ ] Implement; `npm test` passes.

## Task 3: One notch per monitor

- [ ] Move the per-notch code from `Session` into `src/monitor-notch.ts` (`MonitorNotch`).
- [ ] Hook: handler gets `monitorIndex` and returns `null` (drawn) or the monitor for GNOME's popup.
- [ ] `Session`: build notches per monitor, rebuild on `monitors-changed` and on `all_monitors` change, route OSD and Caps Lock with `routeOsd` and the focused monitor.
- [ ] `npm run check`, `npm run lint`, `npm test`.
- [ ] Commit `feat(extension): show a notch on every monitor`.

## Task 4: Devshell and docs

- [ ] `run.sh --monitors N`, `hover.sh on|off [MONITOR]`, `shot.sh` crops every monitor.
- [ ] Devshell check with two monitors (spec 7); commit `chore(devshell): run with several monitors`.
- [ ] `ARCHITECTURE.md`, `docs/testing.md`, README; commit `docs: describe the notch on every monitor`.
