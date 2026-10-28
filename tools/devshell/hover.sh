#!/bin/sh
# Moves the devshell's pointer onto the notch, or away from it, on the
# primary monitor or on monitor number MONITOR.
# Usage: tools/devshell/hover.sh [on|off] [MONITOR]
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
case "${2:-0}" in
    *[!0-9]*) echo "usage: $0 [on|off] [MONITOR]" >&2; exit 2 ;;
esac
case "${1:-on}" in
    on) Y=12 ;;
    off) Y=700 ;;
    *) echo "usage: $0 [on|off] [MONITOR]" >&2; exit 2 ;;
esac
# Moves the pointer DX pixels right of the notch's center. Uses the shell's
# own monitor list: Meta's get_monitor_geometry() reads as zero wide from GJS
# on GNOME 49 and later.
move() {
    OUT=$(shell_eval "
const Clutter = imports.gi.Clutter;
const seat = $SEAT_JS;
global._noktaPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
const monitor = Main.layoutManager.monitors[${MONITOR:-Main.layoutManager.primaryIndex}];
global._noktaPointer.notify_absolute_motion(global.get_current_time() * 1000,
    monitor.x + monitor.width / 2 + $1, monitor.y + $Y);
'moved'
")
    case "$OUT" in
        *moved*) ;;
        *) echo "hover.sh: $OUT" >&2; exit 1 ;;
    esac
}
MONITOR=${2:-}
# A second motion a moment later: GNOME 51 updates hover only once the stage
# picks again.
move 1
sleep 0.1
move 0
