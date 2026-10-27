# shellcheck shell=sh
# Sourced by the helper scripts: points them at the running devshell's bus.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STATE="$ROOT/build/devshell"
[ -f "$STATE/bus" ] || { echo "devshell is not running (tools/devshell/run.sh)" >&2; exit 1; }
DBUS_SESSION_BUS_ADDRESS=$(cat "$STATE/bus")
export DBUS_SESSION_BUS_ADDRESS

# Runs JavaScript inside the devshell's GNOME Shell and prints the result.
shell_eval() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1"
}
