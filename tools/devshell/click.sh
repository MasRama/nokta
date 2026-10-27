#!/bin/sh
# Clicks the devshell's primary button at X Y (screen pixels, as in shot.sh's
# full screenshot). The first click on a window may only focus it.
# Usage: tools/devshell/click.sh X Y
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
usage() { echo "usage: $0 X Y" >&2; exit 2; }
[ $# -eq 2 ] || usage
for n in "$1" "$2"; do
    case "$n" in '' | *[!0-9]*) usage ;; esac
done
shell_eval "
const Clutter = imports.gi.Clutter;
const seat = $SEAT_JS;
global._noktaPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
const now = () => global.get_current_time() * 1000;
global._noktaPointer.notify_absolute_motion(now(), $1, $2);
global._noktaPointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
global._noktaPointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
'clicked'
" > /dev/null
