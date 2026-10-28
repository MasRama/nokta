#!/bin/sh
# Opens Nokta's settings window in the devshell. GNOME's preferences service
# (org.gnome.Shell.Extensions) is started on the devshell bus and display,
# with the devshell's config directories; it exits with the devshell. GTK
# draws with cairo: CI containers have no GPU, and GL there can take longer
# than the smoke test waits for the first frame.
# Usage: tools/devshell/prefs.sh
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"

has_service() {
    gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner org.gnome.Shell.Extensions 2>/dev/null | grep -q true
}

if ! has_service; then
    env -u DISPLAY WAYLAND_DISPLAY=nokta-devshell GDK_BACKEND=wayland GSK_RENDERER=cairo GTK_A11Y=none \
        XDG_CONFIG_HOME="$STATE/config" XDG_DATA_HOME="$STATE/data" \
        XDG_CACHE_HOME="$STATE/cache" XDG_RUNTIME_DIR="$STATE/runtime" \
        GSETTINGS_BACKEND=keyfile \
        setsid gjs -m /usr/share/gnome-shell/org.gnome.Shell.Extensions > "$STATE/prefs.log" 2>&1 &
    i=0
    until has_service; do
        i=$((i + 1))
        [ "$i" -le 50 ] || { echo "preferences service did not start, see $STATE/prefs.log" >&2; exit 1; }
        sleep 0.2
    done
fi
gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions \
    --method org.gnome.Shell.Extensions.OpenExtensionPrefs nokta@nokta.io '' '{}' > /dev/null
