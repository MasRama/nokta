# Publishing on extensions.gnome.org

The extension is published on [extensions.gnome.org](https://extensions.gnome.org)
(EGO) by hand from the maintainer's account; the daemon stays on GitHub
releases.

## Upload

1. Take `nokta@nokta.io.shell-extension.zip` from the
   [GitHub release](https://github.com/MasRama/nokta/releases/latest), not a
   local build, so EGO gets the same code as the release.
2. Sign in on EGO and upload it at <https://extensions.gnome.org/upload/>.
3. Wait for the review. A rejection comes with the reviewer's notes; fix them
   in a normal commit and upload the next release.

## Review checklist

EGO reviewers read the code. Before uploading, check:

- [ ] The code is the readable `tsc` output: no bundler, no minifier.
- [ ] Nothing is created at import time; `enable()` creates and `disable()`
      removes every actor, signal, main-loop source and D-Bus watch.
- [ ] Monkey-patches (the OSD manager, the date menu position) are undone in
      `disable()` and leave alone what another extension changed since.
- [ ] No `unlock-dialog` session mode: GNOME turns the extension off on the
      lock screen.
- [ ] No network, no file I/O and no subprocess in the shell process; that
      work is in `noktad`.
- [ ] The description says that `noktad` is needed and where it comes from.
- [ ] `shell-version` lists only versions the GNOME smoke test passed on.
- [ ] `prefs.js` imports no shell modules (`St`, `Clutter`, `Main`).
