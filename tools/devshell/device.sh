#!/bin/sh
# Drives the fake UPower, BlueZ and PackageKit in the devshell (fake-devices.js).
# Usage: tools/devshell/device.sh plug|unplug
#        tools/devshell/device.sh percent N
#        tools/devshell/device.sh full
#        tools/devshell/device.sh connect [NAME] [BATTERY]
#        tools/devshell/device.sh disconnect
#        tools/devshell/device.sh update PERCENT
#        tools/devshell/device.sh update-done|update-failed
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
# Arguments are GVariant text with explicit types, so -1 is not an option.
fake() {
    method=$1
    shift
    gdbus call --session --dest io.nokta.devshell.FakeDevices \
        --object-path /io/nokta/devshell/FakeDevices \
        --method "io.nokta.devshell.FakeDevices.$method" "$@" > /dev/null
}
case "${1:-}" in
    plug) fake SetCharger true ;;
    unplug) fake SetCharger false ;;
    percent)
        [ $# -eq 2 ] || { echo "usage: $0 percent N" >&2; exit 2; }
        fake SetPercentage "double $2"
        ;;
    full) fake SetFull true ;;
    connect) fake Connect "string '${2:-}'" "int32 ${3:--1}" ;;
    disconnect) fake Disconnect ;;
    update)
        [ $# -eq 2 ] || { echo "usage: $0 update PERCENT" >&2; exit 2; }
        fake Update "uint32 $2"
        ;;
    # PackageKit's exit codes: 1 success, 2 failed.
    update-done) fake FinishUpdate "uint32 1" ;;
    update-failed) fake FinishUpdate "uint32 2" ;;
    *)
        echo "usage: $0 plug | unplug | percent N | full | connect [NAME] [BATTERY] | disconnect | update PERCENT | update-done | update-failed" >&2
        exit 2
        ;;
esac
