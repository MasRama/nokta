#!/bin/sh
# Opens a window that goes fullscreen on the primary monitor, or closes it
# again, and waits until GNOME counts the monitor as fullscreen or not.
# Usage: tools/devshell/fullscreen.sh on|off
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
# Not every container has pkill, so the window's process is kept in a file.
PIDFILE="$STATE/fullscreen-window.pid"
FULLSCREEN='global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex)'
SHOWN='global.get_window_actors().some((a) => a.meta_window.get_title() === "nokta-fullscreen" && a.opacity === 255 && a.scale_x === 1)'

wait_fullscreen() {
    i=0
    until shell_eval "$FULLSCREEN" | grep -q "'$1'"; do
        i=$((i + 1))
        [ "$i" -le 100 ] || { echo "fullscreen.sh: the monitor is not fullscreen=$1, see $STATE/fullscreen-window.log" >&2; exit 1; }
        sleep 0.1
    done
}

case "${1:-}" in
    on)
        [ ! -f "$PIDFILE" ] || exit 0
        # GNOME 49 and later start in the overview, which hides every window.
        shell_eval "Main.overview.hide(); 'ok'" > /dev/null
        env XDG_RUNTIME_DIR="$STATE/runtime" WAYLAND_DISPLAY=nokta-devshell GDK_BACKEND=wayland \
            GSK_RENDERER=cairo GTK_A11Y=none \
            gjs -m "$ROOT/tools/devshell/fullscreen-window.js" > "$STATE/fullscreen-window.log" 2>&1 &
        echo "$!" > "$PIDFILE"
        wait_fullscreen true
        # The map animation fades and scales the window in.
        i=0
        until shell_eval "$SHOWN" | grep -q "'true'"; do
            i=$((i + 1))
            [ "$i" -le 50 ] || { echo "fullscreen.sh: the window did not finish showing" >&2; exit 1; }
            sleep 0.1
        done
        ;;
    off)
        [ -f "$PIDFILE" ] || exit 0
        kill "$(cat "$PIDFILE")" 2> /dev/null || true
        rm -f "$PIDFILE"
        wait_fullscreen false
        ;;
    *)
        echo "usage: $0 on|off" >&2
        exit 2
        ;;
esac
