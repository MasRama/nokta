# Nokta settings window Implementation Plan

**Goal:** A settings window for every key, plus background transparency, an accent color and the clock format.

**Spec:** `docs/specs/2026-10-27-nokta-settings-window-design.md`

**Architecture:** `prefs.js` (GTK 4, libadwaita, own process) calls the new `io.nokta.Settings1.Set`; `noktad` edits `config.toml` with `toml_edit` after validating it; the existing watcher republishes.

## Global constraints

- Contracts first; additions only. Tests first. Heavy commands one at a time.
- The shell side never imports `prefs`; `prefs` never imports `St`, `Clutter` or `Main`.
- New defaults look exactly like today.

## Task 1: New settings

- [ ] Rust and TS tests for `background_opacity`, `accent`, `show_clock`, `clock_format`; implement with validation; default config and README.
- [ ] Commit `feat(settings): add transparency, accent color and clock settings`.

## Task 2: Use them in the notch

- [ ] Tests for `uses24h()` and the background color with opacity; implement.
- [ ] Notch body and ears with opacity; accent for media and OSD bar; clock format and hidden clock.
- [ ] Commit `feat(extension): see-through notch, accent color and 24-hour clock`.

## Task 3: Contract and daemon writes

- [ ] Contract: `Lyrics`, `Set`, `Reset`; `contracts.ts`.
- [ ] `edit.rs` tests first, then implement; `Set` and `Reset` in `dbus.rs`; integration test.
- [ ] Commit `feat(settings): change settings over D-Bus`.

## Task 4: Settings window

- [ ] `logic/schema.ts` with tests; `prefs.ts` and `prefs/`; pack includes `prefs.js`.
- [ ] Commit `feat(settings): add a settings window`.

## Task 5: Check, docs, deploy

- [ ] Devshell check of transparency, accent, clock and the window.
- [ ] README, ARCHITECTURE, testing.md; commit.
- [ ] Merge, push, install, set Ren's `clock_format = "24h"`.
