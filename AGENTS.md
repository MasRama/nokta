# Instructions for coding agents

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing code. It is the
authority on structure and the locked stack.

## Commands

Run from the repository root unless noted.

| Task | Command |
|---|---|
| Format the daemon | `cargo fmt` |
| Lint the daemon | `cargo clippy --all-targets -- -D warnings` |
| Test the daemon | `cargo test` (needs `dbus-daemon`; tests start their own private bus) |
| Build the daemon | `cargo build --release` |
| Install dependencies | `cd extension && npm ci` |
| Type check, contract and translation check | `cd extension && npm run check` |
| Update the translation template | `cd extension && npm run i18n` |
| Lint the extension | `cd extension && npm run lint` |
| Test the extension logic | `cd extension && npm test` |
| Pack the extension | `cd extension && npm run pack` |
| Lint shell scripts | `shellcheck packaging/*.sh packaging/tests/*.sh tools/*.sh tools/devshell/*.sh extension/scripts/*.sh` |
| Check the installer | `NOKTAD=target/debug/noktad packaging/tests/install-dry-run.sh` |
| Try the UI | `tools/devshell/run.sh`, see [docs/testing.md](docs/testing.md) |
| Everything CI runs, before a push | `tools/precheck.sh` (`--quick` skips the GNOME 46-51 containers) |

Run heavy commands (anything that compiles, bundles or tests) one at a time,
never in parallel. Several `cargo` and `tsc` runs at once make the machine
unusable.

## Rules

- **Contracts first.** A change to the D-Bus API starts in `contracts/*.xml`.
  Then update the daemon, `extension/src/shared/contracts.ts` and the tests.
  Never change a published `...1` interface in a breaking way; add `...2`.
- **Feature boundaries.** Import a feature through its `mod.rs` or
  `index.ts` only. Keep feature dependencies acyclic (`lyrics` may use
  `media`, nothing else crosses). `shared/` gets no feature logic.
- **The extension stays light.** No network, no file I/O, no blocking calls
  and no polling in the extension. That work belongs in `noktad`. Every
  signal, source and actor created in `enable()` is removed in `disable()`.
- **Every string the user reads is translated.** Wrap it in `_('…')`, or
  `N_('…')` in a module-level table and `_(x) // i18n: runtime` where it is
  drawn; put numbers in with `format(_('%d min'), n)`, never by
  concatenation. Then `npm run i18n` and add the Indonesian to
  `extension/po/id.po`; `npm run check` fails until it is there.
- **Tests first.** Write the failing test, watch it fail, then fix. Extension
  decisions go in a `logic/` module so they can be tested with Node.
- **Never touch the user's session while testing.** Use `tools/devshell/`,
  which runs on its own bus and its own config directories.
- **Conventional Commits** with a real scope, for example
  `fix(media): keep the last paused player when another one stops`. Scopes in
  use: `media`, `lyrics`, `settings`, `osd`, `devices`, `timer`,
  `activities`, `weather`, `calendar`, `shelf`, `clipboard`, `screenshots`, `privacy`, `themes`, `panel`, `i18n`, `app`, `contracts`, `extension`, `packaging`, `core`. The changelog is generated from these messages, so
  describe the change the user sees.
- Do not edit `CHANGELOG.md` or version numbers by hand. release-please owns
  them.
