#!/bin/sh
# Sets a fake player's status: the first one, or player N from --players.
# Usage: tools/devshell/player.sh Playing|Paused|Stopped [N]
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
case "${1:-}" in
    Playing | Paused | Stopped) ;;
    *) echo "usage: $0 Playing|Paused|Stopped [N]" >&2; exit 2 ;;
esac
case "${2:-1}" in
    1) printf '%s\n' "$1" > "$STATE/player-status" ;;
    [2-9]) printf '%s\n' "$1" > "$STATE/player-$2-status" ;;
    *) echo "usage: $0 Playing|Paused|Stopped [N]" >&2; exit 2 ;;
esac
