# Nokta portable core Implementation Plan

**Goal:** `nokta-core` builds and passes its tests on Linux, macOS and Windows; D-Bus is a Linux adapter at the edge.

**Spec:** `docs/specs/2026-10-28-nokta-portable-core-design.md`

**Architecture:** One crate. Each feature's D-Bus and system-source files are gated with `cfg(target_os = "linux")` in its `mod.rs`; `app` starts portable `Services` and serves them on D-Bus only on Linux.

## Global constraints

- Behavior on Linux does not change; the full test suite stays green after every task.
- Tests first for new code (`SettingValue`, `Paths::for_system`, `Services`).
- Heavy commands one at a time. macOS and Windows are checked only on CI.

## Task 1: Settings without D-Bus types

- [ ] Tests: `entries()` per table, `set_key` with `SettingValue`, conversion from each D-Bus type in `settings::dbus` with the same error texts.
- [ ] `SettingValue`, `entries()` in place of `to_dbus()`, `edit::set_key(&SettingValue)`, conversion in `settings::dbus`.
- [ ] Commit `refactor(settings): keep D-Bus types out of the config model`.

## Task 2: Media without MPRIS types

- [ ] Move `Track::from_metadata` and its tests into `mpris.rs`.
- [ ] Commit `refactor(media): parse MPRIS metadata in the MPRIS module`.

## Task 3: Folders and clock per system

- [ ] Tests: `Paths::for_system` for Linux, macOS and Windows.
- [ ] `Paths::for_system`, `from_env` on top of it; clock with `Instant` on Windows.
- [ ] Commit `feat(core): use each system's folders for config and cache`.

## Task 4: Gate the Linux adapters

- [ ] `Services` in `app`, test that it starts without a bus; `app::dbus` serves it on Linux; other systems return "no frontend on this system yet".
- [ ] `cfg(target_os = "linux")` on every D-Bus and system-source module and on `core/tests/*.rs`; `zbus` and `rustix` become target dependencies.
- [ ] Commit `refactor(core): build the daemon's core without D-Bus outside Linux`.

## Task 5: CI and docs

- [ ] `ci.yml`: "Daemon on macOS and Windows" matrix, clippy and tests.
- [ ] Fix what the runners find, through CI.
- [ ] ARCHITECTURE (portable and Linux parts, folders), README (platform line).
- [ ] Commits `ci: build and test the daemon on macOS and Windows`, `docs: describe the portable core`.
