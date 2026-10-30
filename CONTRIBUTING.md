# Contributing to Nokta

Thanks for helping. This file covers how to set up, what a good change looks
like and how releases work.

## Before you start

- For a bug, open an issue with the steps to reproduce it, unless the fix is
  small and obvious.
- For a new feature, open an issue first and describe what you want to do.
  Each one gets agreed on in the issue before code.
- Read [ARCHITECTURE.md](ARCHITECTURE.md). Changes to the locked stack need
  agreement in an issue first.

## Setup

You need:

- Rust stable (`rustup` picks the toolchain from `rust-toolchain.toml`)
- Node.js 22.13 or newer
- `dbus-daemon` for the daemon's integration tests
- GNOME Shell 46 to try the extension

```sh
cargo test
cd extension
npm ci
npm run check
npm run lint
npm test
```

[docs/testing.md](docs/testing.md) explains the test layers and how to run the
extension in a headless GNOME Shell that cannot touch your own session.

## Making a change

- Write a test that fails without your change, then make it pass.
- Keep the D-Bus contract in `contracts/` as the source of truth. If you
  change it, update both sides in the same pull request.
- Run what CI runs before you push:

  ```sh
  tools/precheck.sh
  ```

  It runs CI's steps one at a time and stops at the first failure: format,
  lint and tests of the daemon and the extension, the shell scripts, the
  installer, the dependency audit (with `cargo-audit` installed), the smoke test here and, with [podman](https://podman.io)
  installed, the smoke test in the containers of every GNOME version CI
  tests. `--quick` skips those containers. The Rust version is pinned in
  `rust-toolchain.toml`, so clippy here says what clippy in CI says.

- For changes to what the notch shows or how it moves, go through the matching
  part of the checklist in [docs/testing.md](docs/testing.md) and add a
  screenshot to the pull request.

## Translations

The extension's text lives in `extension/po/`: `nokta@nokta.io.pot` is the
template and each language has a `.po` file named after its code. Every
string the user reads goes through `_('…')` in the source, or `N_('…')` in a
table built when a module loads, and numbers go in with `format()` and `%s`
or `%d`, so a translation can put them where its grammar wants.

- After changing text in `extension/src/`, run `npm run i18n` in
  `extension/` to update the template, then translate the new entries.
- To add a language, copy the template to `extension/po/<code>.po`, fill in
  every `msgstr`, and add the code to `extension/po/LINGUAS`.
- `npm run check` fails while a language misses an entry, keeps one marked
  fuzzy, or drops a placeholder.

## Commit messages

Nokta uses [Conventional Commits](https://www.conventionalcommits.org/). The
changelog and version numbers are generated from them, so write the message
for someone reading the changelog:

```
feat(lyrics): show plain lyrics when no synced version exists
fix(media): stop the progress bar from jumping back after a seek
docs: explain the Just Perfection clock setting
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`,
`chore`. Scopes: `media`, `lyrics`, `settings`, `osd`, `devices`, `timer`,
`activities`, `weather`, `calendar`, `shelf`, `clipboard`, `downloads`, `screenshots`, `themes`, `panel`, `i18n`, `app`, `contracts`, `extension`, `packaging`, `core`. A breaking change gets a `!` after the
scope and a `BREAKING CHANGE:` footer.

## Releases

Releases are automated with
[release-please](https://github.com/googleapis/release-please). It keeps a
release pull request open that collects the changes on `main`. When a
maintainer merges it, it tags the version, writes `CHANGELOG.md`, and CI
builds and attaches the daemon archive and the extension zip to the GitHub
release. Version numbers follow [SemVer](https://semver.org/); the daemon and
the extension always share one version.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
