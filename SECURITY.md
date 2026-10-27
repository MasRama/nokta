# Security policy

## Supported versions

Only the latest release gets security fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it
privately through
[GitHub's private vulnerability reporting](https://github.com/MasRama/nokta/security/advisories/new).

Include what you found, how to reproduce it and which version you used. You
will get an answer within 7 days. Once a fix is released, the advisory is
published with credit to you unless you prefer otherwise.

## What Nokta touches

Useful context when you look for problems:

- `noktad` runs as your user, never as root, and listens only on your
  session bus.
- It reads `~/.config/nokta/config.toml` and writes to `~/.cache/nokta/`.
- It makes HTTPS requests to lrclib.net for lyrics (unless turned off) and
  downloads cover art from the web addresses media players provide, up to
  5 MB each.
- The GNOME extension runs inside GNOME Shell. It makes no network requests
  and reads no files except the cover art paths the daemon gives it.
