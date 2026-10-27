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
shell_eval "
const Clutter = imports.gi.Clutter;
const seat = $SEAT_JS;
global._noktaPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
const index = ${2:-global.display.get_primary_monitor()};
const monitor = global.display.get_monitor_geometry(index);
global._noktaPointer.notify_absolute_motion(global.get_current_time() * 1000,
    monitor.x + monitor.width / 2, monitor.y + $Y);
'moved'
" > /dev/null
