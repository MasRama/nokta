#!/bin/sh
# Drives noktad's focus timer and clocks (io.nokta.Timer1) in the devshell.
# Usage: tools/devshell/timer.sh start focus|break
#        tools/devshell/timer.sh pause|resume|stop
#        tools/devshell/timer.sh countdown SECONDS [LABEL]
#        tools/devshell/timer.sh stopwatch [LABEL]
#        tools/devshell/timer.sh clear
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
    countdown)
        [ $# -ge 2 ] || { echo "usage: $0 countdown SECONDS [LABEL]" >&2; exit 2; }
        call AddCountdown "${3:-}" "int64 $(($2 * 1000000))"
        ;;
    stopwatch) call AddStopwatch "${2:-}" ;;
    clear) call ClearClocks ;;
    *)
        echo "usage: $0 start focus|break | pause | resume | stop | countdown SECONDS [LABEL] | stopwatch [LABEL] | clear" >&2
        exit 2
        ;;
esac
