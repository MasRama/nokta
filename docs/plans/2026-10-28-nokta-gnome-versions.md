# Nokta GNOME 46 to 51 Implementation Plan

**Goal:** The extension runs on GNOME Shell 46 to 51 and is ready for extensions.gnome.org.

**Spec:** `docs/specs/2026-10-28-nokta-gnome-versions-design.md`

**Architecture:** Feature checks in one `shared/compat.ts`; a second OSD hook for the GNOME 49 API with its mapping in `features/osd/logic/levels.ts`; a smoke test run in a container per GNOME version in CI.

## Global constraints

- Feature checks, never version numbers. Tests first. Heavy commands one at a time.
- GNOME 46 behaves exactly as in v0.2.0.

## Task 1: Compatibility helpers

- [ ] `shared/compat.ts`: `setVertical(box)` and `defaultSeat()`; use them for every vertical box and the Caps Lock keymap.
- [ ] Commit `fix(extension): build vertical boxes and read Caps Lock on newer GNOME`.

## Task 2: OSD hook for GNOME 49

- [ ] `logic/levels.ts` tests first, then implement; `hook.ts` hooks `show` and `showAll` when `showAll` exists.
- [ ] Commit `feat(osd): take over the OSD on GNOME 49 and later`.

## Task 3: Smoke test and CI matrix

- [ ] `tools/devshell/smoke.sh`; check it on 46 locally.
- [ ] `.github/workflows/gnome.yml`: build once, containers for 46, 48, 49, 50, 51; iterate until green.
- [ ] Commit `ci: run Nokta in GNOME Shell 46 to 51`.

## Task 4: Versions, EGO, docs

- [ ] `metadata.json` 46 to 51; banner button to the install instructions.
- [ ] README requirements, `docs/ego.md`, ARCHITECTURE (compat rule), testing.md.
- [ ] Commit; merge, push, install.
