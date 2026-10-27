#!/bin/sh
# Drives noktad's focus timer (io.nokta.Timer1) in the devshell.
# Usage: tools/devshell/timer.sh start focus|break
#        tools/devshell/timer.sh pause|resume|stop
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
call() {
    method=$1
    shift
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Timer \
        --method "io.nokta.Timer1.$method" "$@" > /dev/null
}
case "${1:-}" in
    start)
        [ $# -eq 2 ] || { echo "usage: $0 start focus|break" >&2; exit 2; }
        call Start "$2"
        ;;
    pause) call Pause ;;
    resume) call Resume ;;
    stop) call Stop ;;
    *)
        echo "usage: $0 start focus|break | pause | resume | stop" >&2
        exit 2
        ;;
esac
