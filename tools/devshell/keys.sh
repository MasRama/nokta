#!/bin/sh
# Presses keys together with a virtual keyboard: each is held in order, then
# all are released in reverse. Names are Clutter key names.
# Usage: tools/devshell/keys.sh KEY...   e.g. keys.sh Super_L Alt_L f
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
[ $# -ge 1 ] || { echo "usage: $0 KEY..." >&2; exit 2; }
names=""
for key in "$@"; do
    case "$key" in '' | *[!A-Za-z0-9_]*) echo "bad key name: $key" >&2; exit 2 ;; esac
    names="$names'$key',"
done
shell_eval "
const Clutter = imports.gi.Clutter;
const seat = $SEAT_JS;
global._noktaKeyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
const keys = [$names].map((name) => Clutter['KEY_' + name]);
if (keys.some((key) => key === undefined)) throw new Error('unknown key');
let now = global.get_current_time() * 1000;
for (const key of keys) global._noktaKeyboard.notify_keyval(now++, key, Clutter.KeyState.PRESSED);
for (const key of keys.reverse()) global._noktaKeyboard.notify_keyval(now++, key, Clutter.KeyState.RELEASED);
'pressed'
" > /dev/null
