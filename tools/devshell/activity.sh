#!/bin/sh
# Drives noktad's live activities (io.nokta.Activities1) in the devshell.
# Usage: tools/devshell/activity.sh set ID TITLE DETAIL PROGRESS
#        tools/devshell/activity.sh end ID ok|failed [MESSAGE]
# PROGRESS is 0 to 1, or -1 when unknown.
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
call() {
    method=$1
    shift
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Activities \
        --method "io.nokta.Activities1.$method" "$@" > /dev/null
}
case "${1:-}" in
    set)
        [ $# -eq 5 ] || { echo "usage: $0 set ID TITLE DETAIL PROGRESS" >&2; exit 2; }
        call Set "$2" "$3" "$4" "" "double $5"
        ;;
    end)
        [ $# -ge 3 ] || { echo "usage: $0 end ID ok|failed [MESSAGE]" >&2; exit 2; }
        case "$3" in
            ok) success=true ;;
            failed) success=false ;;
            *) echo "usage: $0 end ID ok|failed [MESSAGE]" >&2; exit 2 ;;
        esac
        call End "$2" "$success" "${4:-}"
        ;;
    *)
        echo "usage: $0 set ID TITLE DETAIL PROGRESS | end ID ok|failed [MESSAGE]" >&2
        exit 2
        ;;
esac
