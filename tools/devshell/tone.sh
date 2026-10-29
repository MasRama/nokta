#!/bin/sh
# Plays a 100 Hz tone into what noktad records for the bars that follow the
# music ([media] real_equalizer). The devshell has no session manager to
# link the recording to the speakers, so this links the tone to it by hand.
# Usage: tools/devshell/tone.sh on|off
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=tools/devshell/env.sh
. "$HERE/env.sh"
XDG_RUNTIME_DIR="$STATE/runtime"
export XDG_RUNTIME_DIR
[ -S "$XDG_RUNTIME_DIR/pipewire-0" ] || { echo "the devshell has no PipeWire (run.sh --no-audio?)" >&2; exit 1; }
PIDFILE="$STATE/tone.pid"
TONE="$STATE/tone.wav"

# pw-link and pw-cli can wait forever on a node that never settles.
pw() {
    timeout 3 "$@"
}

# The mono ports a session manager would give a stream, in direction $1.
ports() {
    echo "{ \"direction\": \"$1\", \"mode\": \"dsp\", \"format\": { \"mediaType\": \"audio\",
        \"mediaSubtype\": \"raw\", \"format\": \"F32P\", \"rate\": 48000, \"channels\": 1, \"position\": [ \"MONO\" ] } }"
}

# Waits until the node $1 has the port $3, in direction $2 (Input or
# Output), asking for its ports until then.
wait_port() {
    flag=-i
    [ "$2" = Input ] || flag=-o
    i=0
    until pw pw-link "$flag" | grep -q "^$1:$3\$"; do
        pw pw-cli set-param "$1" PortConfig "$(ports "$2")" > /dev/null 2>&1 || true
        i=$((i + 1))
        if [ "$i" -gt 100 ]; then
            echo "tone.sh: $1 got no $3; ports:" >&2
            pw pw-link -io >&2 || true
            exit 1
        fi
        sleep 0.1
    done
}

case "${1:-}" in
    on)
        [ ! -f "$PIDFILE" ] || exit 0
        [ -f "$TONE" ] || python3 - "$TONE" << 'PY'
import math, struct, sys, wave
with wave.open(sys.argv[1], "wb") as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(16000)
    out.writeframes(b"".join(
        struct.pack("<h", int(16000 * math.sin(2 * math.pi * 100 * i / 16000)))
        for i in range(16000 * 120)))
PY
        # noktad's recording, once it records.
        wait_port nokta-levels Input input_MONO
        pw-play -P '{ node.name = nokta-tone }' "$TONE" > "$STATE/tone.log" 2>&1 &
        echo $! > "$PIDFILE"
        wait_port nokta-tone Output output_MONO
        pw pw-link nokta-tone:output_MONO nokta-levels:input_MONO
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
