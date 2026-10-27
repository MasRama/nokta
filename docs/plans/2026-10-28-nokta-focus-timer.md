# Nokta focus timer Implementation Plan

**Goal:** A focus timer in the notch, owned by `noktad`, started from Quick Settings.

**Spec:** `docs/specs/2026-10-28-nokta-focus-timer-design.md`

**Architecture:** A new `timer` feature on both sides with the `io.nokta.Timer1` contract; lengths come from a new `[timer]` config table.

## Global constraints

- Contracts first, tests first, heavy commands one at a time.
- The extension adds one 1 s timer, only while a timer runs and is shown.

## Task 1: Contract and config

- [ ] `contracts/io.nokta.Timer1.xml`; `Timer` in `io.nokta.Settings1.xml`.
- [ ] `[timer]` in `Config`, the default file, validation, `to_dbus`, `Set`; tests first.
- [ ] Commit `feat(settings): add focus timer lengths and sound to the config`.

## Task 2: Daemon timer

- [ ] `logic.rs` tests first, then `service.rs` tests with millisecond lengths, then `dbus.rs`, wired in `app`; contract test covers `Timer1`.
- [ ] Commit `feat(timer): run a focus timer in noktad`.

## Task 3: Extension

- [ ] `features/timer/logic` tests first; client, Quick Settings toggle, notch label, alert on `Finished`, sound.
- [ ] Settings window group; `contracts.ts` types.
- [ ] Devshell check with screenshots; `smoke.sh` timer check.
- [ ] Commit `feat(timer): show a focus timer in the notch`.

## Task 4: Docs, merge, install

- [ ] README feature list, ARCHITECTURE (feature, contract table), testing checklist.
- [ ] Full verification, merge, push, install.
