#!/bin/sh
# Drags FILE... from a small window onto the notch of the primary monitor
# with the devshell's pointer and drops them there. With --hold it stops
# before the drop, with the files still over the notch, and `drop.sh
# --release` drops them later.
# Usage: tools/devshell/drop.sh [--hold] FILE... | tools/devshell/drop.sh --release
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"

pointer() {
    OUT=$(shell_eval "
const Clutter = imports.gi.Clutter;
const seat = $SEAT_JS;
global._noktaPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
const p = global._noktaPointer;
const t = global.get_current_time() * 1000;
$1;
'done'
")
    case "$OUT" in
        *done*) ;;
        *) echo "drop.sh: $OUT" >&2; exit 1 ;;
    esac
}
button() { pointer "p.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.$1)"; }

release() {
    button RELEASED
    sleep 1
    pkill -f 'gjs -m .*devshell/[d]rag-source.js' || true
}

HOLD=0
case "${1:-}" in
    --release) release; exit 0 ;;
    --hold) HOLD=1; shift ;;
esac
[ "$#" -gt 0 ] || { echo "usage: $0 [--hold] FILE... | $0 --release" >&2; exit 2; }

# A window left from an earlier drag would lie under this one.
pkill -f 'gjs -m .*devshell/[d]rag-source.js' || true
env XDG_RUNTIME_DIR="$STATE/runtime" WAYLAND_DISPLAY=nokta-devshell GDK_BACKEND=wayland \
    GSK_RENDERER=cairo GTK_A11Y=none ${GDK_DEBUG:+GDK_DEBUG=$GDK_DEBUG} \
    gjs -m "$ROOT/tools/devshell/drag-source.js" "$@" > "$STATE/drag-source.log" 2>&1 &

# Where the source window's center is, once it is shown.
WINDOW='global.get_window_actors().map((a) => a.get_meta_window()).find((w) => w.title === "nokta-drag-source" && !w.is_hidden())'
CENTER="const w = $WINDOW; const r = w?.get_frame_rect(); r ? (r.x + Math.round(r.width / 2)) + ' ' + (r.y + Math.round(r.height / 2)) : ''"
i=0
until FROM=$(shell_eval "$CENTER" | sed -n "s/^(true, '\"\([0-9]* [0-9]*\)\"')\$/\1/p") && [ -n "$FROM" ]; do
    i=$((i + 1))
    [ "$i" -le 50 ] || { echo "drop.sh: the drag source window did not show" >&2; exit 1; }
    sleep 0.1
done
X=${FROM% *}
Y=${FROM#* }

# A window just shown may not take input yet, and the first click on a
# window that is not focused only focuses it.
sleep 0.5
shell_eval "$WINDOW.activate(global.get_current_time()); 'ok'" > /dev/null
pointer "p.notify_absolute_motion(t, $X, $Y)"
sleep 0.3
button PRESSED
# In steps, so GTK sees a drag and the shell sees it reach the notch.
TO_JS='const m = Main.layoutManager.monitors[Main.layoutManager.primaryIndex]; const tx = m.x + m.width / 2; const ty = m.y + 12'
i=0
while [ "$i" -le 20 ]; do
    pointer "$TO_JS; p.notify_absolute_motion(t, $X + (tx - $X) * $i / 20, $Y + (ty - $Y) * $i / 20)"
    sleep 0.05
    i=$((i + 1))
done
# The helper window takes a moment to lie over the open drop area, and the
# drag reaches it with the next motion.
for DY in 20 24 28; do
    sleep 0.3
    pointer "$TO_JS; p.notify_absolute_motion(t, tx + 1, ty + $DY)"
done
sleep 0.3
[ "$HOLD" = 1 ] || release
