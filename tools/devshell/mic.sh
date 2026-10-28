#!/bin/sh
# Starts or stops a fake call: a silent recording from the devshell's
# microphone by io.nokta.FakeCall (fake-call.desktop), which turns GNOME's
# microphone indicator on.
# Usage: tools/devshell/mic.sh on|off
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=tools/devshell/env.sh
. "$HERE/env.sh"
XDG_RUNTIME_DIR="$STATE/runtime"
export XDG_RUNTIME_DIR
[ -S "$XDG_RUNTIME_DIR/pipewire-0" ] || { echo "the devshell has no PipeWire (run.sh --no-audio?)" >&2; exit 1; }
PIDFILE="$STATE/mic.pid"
# The ports a session manager would give a stream.
PORTS='{ "direction": "Input", "mode": "dsp", "format": { "mediaType": "audio", "mediaSubtype": "raw",
    "format": "F32P", "rate": 48000, "channels": 2, "position": [ "FL", "FR" ] } }'

# pw-link and pw-cli can wait forever on a node that never settles.
pw() {
    timeout 3 "$@"
}

# Lists the ports, then gives up.
give_up() {
    echo "$1, see $STATE/mic.log; ports:" >&2
    pw pw-link -io >&2 || true
    exit 1
}

# Waits until the stream $1 has the input $2, asking for its ports until
# then: pw-cli says nothing useful when the node is not there yet.
wait_port() {
    i=0
    until pw pw-link -i | grep -q "^$1:$2\$"; do
        pw pw-cli set-param "$1" PortConfig "$PORTS" > /dev/null 2>&1 || true
        i=$((i + 1))
        [ "$i" -le 50 ] || give_up "$1 got no ports"
        sleep 0.1
    done
}

case "${1:-}" in
    on)
        [ ! -f "$PIDFILE" ] || exit 0
        pw-record -P '{ node.name = nokta-fake-call application.id = io.nokta.FakeCall application.name = "Fake Call" }' \
            /dev/null > "$STATE/mic.log" 2>&1 &
        echo $! > "$PIDFILE"
        # Without a session manager the call has no ports and nothing links
        # it to the microphone. GNOME 51 shows its indicator only while the
        # microphone runs; older ones need just the recording. Some PipeWire
        # versions give the microphone no usable outputs (asking for them
        # breaks it), and then the call records unlinked.
        wait_port nokta-fake-call input_FR
        for channel in FL FR; do
            if port=$(pw pw-link -o | grep -m1 "^nokta-microphone:[a-z]*_$channel\$"); then
                pw pw-link "$port" "nokta-fake-call:input_$channel" || give_up "cannot link $port"
            else
                echo "mic.sh: the microphone has no $channel output, the call records unlinked" >&2
            fi
        done
        ;;
    off)
        [ -f "$PIDFILE" ] || exit 0
        kill "$(cat "$PIDFILE")" 2> /dev/null || true
        rm -f "$PIDFILE"
        ;;
    *)
        echo "usage: $0 on|off" >&2
        exit 2
        ;;
esac
