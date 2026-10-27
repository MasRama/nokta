#!/bin/sh
# Stops a running devshell and everything it started.
set -eu
PIDFILE="$(cd "$(dirname "$0")/../.." && pwd)/build/devshell/run.pid"
[ -f "$PIDFILE" ] || { echo "devshell is not running" >&2; exit 1; }
PID=$(cat "$PIDFILE")
kill -TERM "$PID"
while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
