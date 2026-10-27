#!/bin/sh
# Shows an OSD in the devshell the way gnome-settings-daemon does
# (org.gnome.Shell.ShowOSD), or toggles Caps Lock with a virtual keyboard.
# Usage: tools/devshell/osd.sh level ICON LEVEL [MAX_LEVEL]
#        tools/devshell/osd.sh label ICON TEXT
#        tools/devshell/osd.sh capslock
# With CONNECTOR=Meta-1 in the environment the OSD is for that monitor only,
# as gnome-settings-daemon does for the brightness of one screen.
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
show_osd() {
    params=$1
    [ -z "${CONNECTOR:-}" ] || params="{'connector': <'$CONNECTOR'>, ${params#\{}"
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.ShowOSD "$params" > /dev/null
}
case "${1:-}" in
    level)
        [ $# -ge 3 ] || { echo "usage: $0 level ICON LEVEL [MAX_LEVEL]" >&2; exit 2; }
        show_osd "{'icon': <'$2'>, 'level': <double $3>, 'max_level': <double ${4:-1}>}"
        ;;
    label)
        [ $# -eq 3 ] || { echo "usage: $0 label ICON TEXT" >&2; exit 2; }
        show_osd "{'icon': <'$2'>, 'label': <'$3'>}"
        ;;
    capslock)
        shell_eval "
const Clutter = imports.gi.Clutter;
const seat = $SEAT_JS;
global._noktaKeyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
const now = global.get_current_time() * 1000;
global._noktaKeyboard.notify_keyval(now, Clutter.KEY_Caps_Lock, Clutter.KeyState.PRESSED);
global._noktaKeyboard.notify_keyval(now + 1, Clutter.KEY_Caps_Lock, Clutter.KeyState.RELEASED);
'toggled'
" > /dev/null
        ;;
    *)
        echo "usage: $0 level ICON LEVEL [MAX_LEVEL] | label ICON TEXT | capslock" >&2
        exit 2
        ;;
esac
