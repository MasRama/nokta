#!/bin/sh
# Sets the fake player's status.
# Usage: tools/devshell/player.sh Playing|Paused|Stopped
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
case "${1:-}" in
    Playing | Paused | Stopped) printf '%s\n' "$1" > "$STATE/player-status" ;;
    *) echo "usage: $0 Playing|Paused|Stopped" >&2; exit 2 ;;
esac
