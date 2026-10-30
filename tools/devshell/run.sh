#!/bin/sh
# Runs Nokta in an isolated, headless GNOME Shell: a private session bus,
# temporary XDG directories and GSettings in a keyfile, so nothing touches
# the real session or its settings. A fake session manager (fake-session.js)
# keeps inhibitors for the Caffeine toggle. Stays in the foreground; Ctrl-C
# stops it.
#
# Usage: tools/devshell/run.sh [--no-daemon] [--no-player] [--no-audio] [--players=N] [--monitors=N]
#   --no-daemon   do not start noktad (the notch must stay idle)
#                 nor the fake UPower and BlueZ (fake-devices.js)
#   --no-player   do not start the fake MPRIS player
#   --no-audio    do not start the private PipeWire with two silent outputs
#                 (it is skipped anyway when PipeWire is not installed)
#   --players=N   N fake players (default 1); the others start paused
#   --monitors=N  N virtual 1920x1080 monitors side by side (default 1)
#
# Needs: target/{release,debug}/noktad and the packed extension
# (cd extension && npm run pack). Then use shot.sh, hover.sh, player.sh,
# osd.sh, device.sh and stop.sh.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/tools/devshell"
STATE="$ROOT/build/devshell"
ZIP="$ROOT/build/nokta@nokta.io.shell-extension.zip"

if [ -z "${NOKTA_DEVSHELL_INNER:-}" ]; then
    START_DAEMON=1
    START_PLAYER=1
    START_AUDIO=1
    PLAYERS=1
    MONITORS=1
    for arg in "$@"; do
        case "$arg" in
            --no-daemon) START_DAEMON=0 ;;
            --no-player) START_PLAYER=0 ;;
            --no-audio) START_AUDIO=0 ;;
            --players=[1-9]) PLAYERS=${arg#--players=} ;;
            --monitors=[1-9]) MONITORS=${arg#--monitors=} ;;
            *) echo "unknown option: $arg" >&2; exit 2 ;;
        esac
    done
    [ -f "$ZIP" ] || { echo "missing $ZIP: run 'npm run pack' in extension/" >&2; exit 1; }
    NOKTAD="$ROOT/target/release/noktad"
    [ -x "$NOKTAD" ] || NOKTAD="$ROOT/target/debug/noktad"
    [ -x "$NOKTAD" ] || { echo "missing noktad: run 'cargo build'" >&2; exit 1; }

    rm -rf "$STATE"
    mkdir -p "$STATE/config/glib-2.0/settings" "$STATE/data/gnome-shell/extensions" \
        "$STATE/cache" "$STATE/runtime" "$STATE/lrclib/api" "$STATE/lrclib/v1" "$ROOT/build/shots"
    chmod 700 "$STATE/runtime"

    EXT="$STATE/data/gnome-shell/extensions"
    unzip -q "$ZIP" -d "$EXT/nokta@nokta.io"
    # What gnome-extensions install would do.
    glib-compile-schemas "$EXT/nokta@nokta.io/schemas"
    cp -r "$HERE/devtools@nokta.io" "$EXT/"
    mkdir -p "$STATE/config/pipewire/pipewire.conf.d"
    cp "$HERE/pipewire.conf" "$STATE/config/pipewire/pipewire.conf.d/nokta-devshell.conf"
    mkdir -p "$STATE/data/applications"
    cp "$HERE/fake-call.desktop" "$STATE/data/applications/io.nokta.FakeCall.desktop"

    cat > "$STATE/config/glib-2.0/settings/keyfile" <<'KEYFILE'
[org/gnome/shell]
enabled-extensions=['devtools@nokta.io', 'nokta@nokta.io']
disable-user-extensions=false
welcome-dialog-last-shown-version='999'
KEYFILE

    # A bare session bus: no system service directories, so the shell does
    # not start gvfs, portals or evolution (and their FUSE mounts) in here.
    mkdir -p "$STATE/services"
    cat > "$STATE/bus.conf" <<BUSCONF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:dir=$STATE/runtime</listen>
  <auth>EXTERNAL</auth>
  <servicedir>$STATE/services</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
BUSCONF

    # LRCLIB, Open-Meteo and GitHub stand-in: http.server ignores the query,
    # so /api/get always answers with this record, /v1/search with Jakarta and
    # /v1/forecast with the same weather, on every run. GitHub has no release
    # until the smoke test writes one.
    cp "$HERE/lyrics.json" "$STATE/lrclib/api/get"
    cp "$HERE/place.json" "$STATE/lrclib/v1/search"
    cp "$HERE/forecast.json" "$STATE/lrclib/v1/forecast"

    exec env -u DISPLAY -u WAYLAND_DISPLAY -u GNOME_SETUP_DISPLAY \
        NOKTA_DEVSHELL_INNER=1 START_DAEMON="$START_DAEMON" START_PLAYER="$START_PLAYER" START_AUDIO="$START_AUDIO" \
        PLAYERS="$PLAYERS" MONITORS="$MONITORS" \
        NOKTAD="$NOKTAD" \
        XDG_CONFIG_HOME="$STATE/config" XDG_DATA_HOME="$STATE/data" \
        XDG_CACHE_HOME="$STATE/cache" XDG_RUNTIME_DIR="$STATE/runtime" \
        GSETTINGS_BACKEND=keyfile \
        dbus-run-session --config-file="$STATE/bus.conf" -- "$0"
fi

# Inside the private bus from here on.
PIDS=""
cleanup() {
    if [ -n "$PIDS" ]; then
        # shellcheck disable=SC2086
        kill $PIDS 2>/dev/null || true
    fi
    rm -f "$STATE/bus" "$STATE/run.pid"
}
trap cleanup EXIT
trap 'exit 0' INT TERM
echo "$$" > "$STATE/run.pid"

has_name() {
    gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner "$1" 2>/dev/null | grep -q true
}

wait_name() {
    i=0
    until has_name "$1"; do
        i=$((i + 1))
        [ "$i" -le 150 ] || { echo "timed out waiting for $1" >&2; exit 1; }
        sleep 0.2
    done
}

wait_file() {
    i=0
    until [ -e "$1" ]; do
        i=$((i + 1))
        [ "$i" -le 50 ] || { echo "timed out waiting for $1" >&2; exit 1; }
        sleep 0.1
    done
}

# A private PipeWire (the runtime directory is ours, so the real one is never
# reached) with the two outputs from pipewire.conf, started before the shell
# connects to it. There is no session manager; the loop does its one job
# here and makes the output the shell picks the default.
if [ "$START_AUDIO" = 1 ] && command -v pipewire-pulse > /dev/null 2>&1 && command -v pw-metadata > /dev/null 2>&1; then
    pipewire > "$STATE/pipewire.log" 2>&1 &
    PIDS="$PIDS $!"
    wait_file "$XDG_RUNTIME_DIR/pipewire-0"
    pipewire-pulse > "$STATE/pipewire-pulse.log" 2>&1 &
    PIDS="$PIDS $!"
    wait_file "$XDG_RUNTIME_DIR/pulse/native"
    pw-metadata -n default 0 default.audio.sink '{"name":"nokta-speakers"}' > /dev/null
    pw-metadata -n default 0 default.audio.source '{"name":"nokta-microphone"}' > /dev/null
    stdbuf -oL pw-metadata -n default -m 2> /dev/null | while read -r line; do
        case "$line" in
            *"key:'default.configured.audio.sink'"*)
                value=${line#*value:\'}
                pw-metadata -n default 0 default.audio.sink "${value%%\'*}" > /dev/null
                ;;
        esac
    done &
    PIDS="$PIDS $!"
fi

set --
i=0
while [ "$i" -lt "$MONITORS" ]; do
    set -- "$@" --virtual-monitor 1920x1080
    i=$((i + 1))
done
# The shell's system bus is this bus too: it never talks to the real logind,
# and containers without a system bus work.
DBUS_SYSTEM_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" gnome-shell --headless --wayland --no-x11 "$@" \
    --wayland-display nokta-devshell > "$STATE/shell.log" 2>&1 &
SHELL_PID=$!
PIDS="$PIDS $SHELL_PID"
wait_name org.gnome.Shell.Screenshot
# Started after the shell, which needs no session manager of its own here.
gjs -m "$HERE/fake-session.js" > "$STATE/session.log" 2>&1 &
PIDS="$PIDS $!"
wait_name org.gnome.SessionManager

if [ "$START_PLAYER" = 1 ]; then
    gjs -m "$HERE/fake-player.js" "$STATE" > "$STATE/player.log" 2>&1 &
    PIDS="$PIDS $!"
    wait_name org.mpris.MediaPlayer2.noktafake
    n=2
    while [ "$n" -le "$PLAYERS" ]; do
        printf 'Paused\n' > "$STATE/player-$n-status"
        gjs -m "$HERE/fake-player.js" "$STATE" "$n" > "$STATE/player-$n.log" 2>&1 &
        PIDS="$PIDS $!"
        wait_name "org.mpris.MediaPlayer2.noktafake$n"
        n=$((n + 1))
    done
fi

if [ "$START_DAEMON" = 1 ]; then
    PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
    python3 -m http.server -b 127.0.0.1 -d "$STATE/lrclib" "$PORT" > "$STATE/lrclib.log" 2>&1 &
    PIDS="$PIDS $!"
    until python3 -c "import socket, sys; socket.create_connection(('127.0.0.1', $PORT), 1)" 2>/dev/null; do
        sleep 0.1
    done
    # noktad's system bus is this bus, where fake-devices.js plays UPower and BlueZ.
    gjs -m "$HERE/fake-devices.js" > "$STATE/devices.log" 2>&1 &
    PIDS="$PIDS $!"
    wait_name io.nokta.devshell.FakeDevices
    # noktad reads meeting links and calendar colors from this calendar server.
    gjs -m "$HERE/fake-eds.js" > "$STATE/eds.log" 2>&1 &
    PIDS="$PIDS $!"
    wait_name org.gnome.evolution.dataserver.Calendar8
    wait_name org.gnome.evolution.dataserver.Sources5
    DBUS_SYSTEM_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" NOKTA_LRCLIB_URL="http://127.0.0.1:$PORT" \
        NOKTA_OPEN_METEO_URL="http://127.0.0.1:$PORT" NOKTA_OPEN_METEO_GEOCODING_URL="http://127.0.0.1:$PORT" \
        NOKTA_GITHUB_API_URL="http://127.0.0.1:$PORT" \
        "$NOKTAD" > "$STATE/noktad.log" 2>&1 &
    PIDS="$PIDS $!"
    echo "$!" > "$STATE/noktad.pid"
    wait_name io.nokta.Nokta
fi

echo "$DBUS_SESSION_BUS_ADDRESS" > "$STATE/bus"
echo "devshell ready (state in $STATE)"
wait "$SHELL_PID"
