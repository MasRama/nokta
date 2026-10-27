# Nokta design: a portable core

Status: approved (Ren asked for cross-platform groundwork built to Claude's
recommendation, and has no Windows or macOS machine to test on)
Date: 2026-10-28
Scope: the daemon only. Split `nokta-core` into a portable part and Linux
adapters, so it builds and its tests pass on Linux, macOS and Windows. No
new frontend.

## 1. Goal

Nokta is meant to come to Windows and macOS. Today every feature in
`noktad` reaches into D-Bus: settings publish `zvariant` values, the
settings window's `Set` takes one, the media track is parsed from MPRIS
metadata, and `app` assumes Unix signals and `CLOCK_MONOTONIC`. Nothing of
the daemon builds outside Linux.

This change makes D-Bus one transport, kept at the edge, and proves on CI
runners that the rest builds and works on all three systems. A Windows or
macOS frontend is out of scope: nobody can try one, so it would ship
unverified.

### Success criteria

1. `cargo build` and `cargo test` pass on `ubuntu`, `macos` and `windows`
   GitHub runners, with clippy clean on each.
2. On Linux, `noktad` behaves exactly as before; every existing test still
   passes and the contract is unchanged.
3. Only Linux adapters import `zbus` or `rustix`. On other systems they are
   not compiled and those crates are not dependencies.
4. On macOS and Windows `noktad` starts, says it has no frontend on this
   system yet, and exits with an error. `--version` and `--help` work.
5. Config and cache folders follow each system's convention.

## 2. Approaches

1. **One crate, Linux adapters behind `cfg(target_os = "linux")`
   (chosen).** The feature folders stay as they are; each feature's
   D-Bus and system-source files are gated in its `mod.rs`. The smallest
   change, and the feature boundaries already separate logic from I/O.
2. A workspace of `nokta-core` (portable) and `noktad-linux`. A cleaner
   compile-time wall, but it moves most files, splits every feature across
   two crates and breaks the "same feature name on both sides" rule.
   Worth it once a second frontend exists; not before.
3. A runtime transport trait with D-Bus as one implementation. Abstracts
   over one implementation; the trait's shape would be a guess until a
   second transport is real.

## 3. Portable and Linux parts

| Feature | Portable | Linux only |
|---|---|---|
| media | `MediaState`, `Track`, `PlaybackStatus`, `select`, `art` | `mpris` (with parsing MPRIS metadata into a `Track`), `watcher`, `control`, `dbus` |
| lyrics | everything but `dbus` | `dbus` |
| settings | config, validation, `edit`, store, file watching, service | `dbus` |
| devices | `rules` | `bluez`, `upower`, `watcher`, `dbus` |
| timer | `logic`, `service` | `dbus` |
| shared | `paths`, `clock`, `hash`, `http` | `dbus` |
| app | starting the portable services | serving them on the bus, the bus name, Unix signals |

### Settings without D-Bus types

`settings` gets its own value type:

```rust
pub enum SettingValue { Bool(bool), Uint(u32), Float(f64), Text(String) }
```

- Each config table lists its keys with `entries() -> Vec<(&'static str, SettingValue)>`
  in place of `to_dbus()`. `settings::dbus` turns that into `a{sv}`.
- `edit::set_key` takes a `SettingValue`. `settings::dbus` converts the
  `Set` argument: booleans, strings, and any integer or finite double
  type become a number. The error texts the settings window shows stay the
  same, including the value in "got ...".

### Media without MPRIS types

`Track::from_metadata` moves to `mpris.rs` as `track_from_metadata`, with
its tests. `Track` stays a plain struct.

### The clock

`shared::clock::monotonic_us()` keeps `CLOCK_MONOTONIC` on Unix (the
extension compares it with `GLib.get_monotonic_time()`). On Windows it
counts from the first call with `std::time::Instant`. A Windows frontend
will decide its own time base; the spec for it can change this.

### Folders

| System | Config file | Cache |
|---|---|---|
| Linux | `$XDG_CONFIG_HOME/nokta/config.toml`, else `~/.config/...` | `$XDG_CACHE_HOME/nokta`, else `~/.cache/nokta` |
| macOS | `~/Library/Application Support/nokta/config.toml` | `~/Library/Caches/nokta` |
| Windows | `%APPDATA%\nokta\config.toml` | `%LOCALAPPDATA%\nokta\cache` |

`Paths::for_system(system, env)` is pure and tested for all three on every
runner; `Paths::from_env()` calls it for the running system.

### app

`app` starts the portable services into one `Services` value (media state,
lyrics, config, timer, alerts). On Linux `app::dbus` connects, serves
`Services` and owns the bus name, as today. On other systems `app::run`
returns an error: "Nokta has no frontend on this system yet".

## 4. Dependencies

`zbus` and `rustix` move to `[target.'cfg(target_os = "linux")'.dependencies]`
(`rustix` to `cfg(unix)`, for the clock on macOS). No new crates. The
integration tests in `core/tests/` all need a D-Bus daemon, so each is
gated on Linux.

## 5. CI

A new job "Daemon on macOS and Windows" in `ci.yml`, a matrix of
`macos-latest` and `windows-latest`: `cargo clippy --all-targets --locked
-- -D warnings` and `cargo test --locked`. The Linux job is unchanged.

## 6. Testing

- Existing tests keep passing on Linux (the refactor is behavior-neutral).
- New tests: `SettingValue` conversion in `settings::dbus` (each D-Bus type,
  and the error text), `Paths::for_system` for each system, and
  `Services` starting without any D-Bus (timer and settings reachable).
- macOS and Windows are checked only by CI. Anything found there is fixed
  through the same CI loop.

## 7. Out of scope

A Windows or macOS frontend, media sources for those systems (SMTC,
MediaRemote), installers, a second transport, and the README promising
either system. The README says the daemon's core builds on them.
