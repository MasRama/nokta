#!/bin/sh
# Moves the devshell's pointer onto the notch, or away from it.
# Usage: tools/devshell/hover.sh [on|off]
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
case "${1:-on}" in
    on) Y=12 ;;
    off) Y=700 ;;
    *) echo "usage: $0 [on|off]" >&2; exit 2 ;;
esac
shell_eval "
const Clutter = imports.gi.Clutter;
const seat = Clutter.get_default_backend().get_default_seat();
global._noktaPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
const monitor = global.display.get_monitor_geometry(global.display.get_primary_monitor());
global._noktaPointer.notify_absolute_motion(global.get_current_time() * 1000,
    monitor.x + monitor.width / 2, monitor.y + $Y);
'moved'
" > /dev/null
