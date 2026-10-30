#!/bin/sh
# Runs what CI runs, one step at a time, so a push meets no surprises:
# the daemon's format, lint and tests, the shell scripts, the dependency
# audit (with cargo-audit installed), the extension, then the smoke test on
# this machine and in every GNOME version CI tests (podman). The daemon on Windows and macOS is left to CI: its C
# dependencies do not cross-compile from here.
# Usage: tools/precheck.sh [--quick]   (--quick skips the GNOME matrix)
# Stops at the first failure; the output of each step is in build/precheck/.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOGS="$ROOT/build/precheck"
QUICK=false
[ "${1:-}" = --quick ] && QUICK=true
cd "$ROOT"
rm -rf "$LOGS"
mkdir -p "$LOGS"

n=0
step() {
    n=$((n + 1))
    name=$1
    shift
    log="$LOGS/$n-$(echo "$name" | tr ' /' '--').log"
    printf 'precheck: %s ... ' "$name"
    start=$(date +%s)
    if "$@" > "$log" 2>&1; then
        echo "ok ($(($(date +%s) - start)) s)"
    else
        echo "FAILED"
        tail -30 "$log"
        echo "precheck: the whole output is in $log"
        exit 1
    fi
}
in_extension() { (cd extension && "$@"); }

step "cargo fmt" cargo fmt --check
step "cargo clippy" cargo clippy --all-targets --locked -- -D warnings
step "cargo test" cargo test --locked
step "shellcheck" sh -c 'shellcheck packaging/*.sh packaging/tests/*.sh tools/*.sh tools/devshell/*.sh extension/scripts/*.sh'
step "installer dry run" env NOKTAD=target/debug/noktad packaging/tests/install-dry-run.sh
if command -v cargo-audit > /dev/null; then
    step "cargo audit" cargo audit
else
    echo "precheck: no cargo-audit, so the dependency audit runs only in CI"
fi
step "npm ci" in_extension npm ci
step "npm run check" in_extension npm run check
step "npm run lint" in_extension npm run lint
step "npm test" in_extension npm test
step "cargo build --release" cargo build --release --locked
step "npm run pack" in_extension npm run pack
step "smoke (this machine)" tools/devshell/smoke.sh
if [ "$QUICK" = true ]; then
    echo "precheck: skipped the GNOME matrix (--quick)"
elif command -v podman > /dev/null; then
    step "smoke in GNOME 46-51 (podman)" tools/devshell/matrix.sh
else
    echo "precheck: no podman, so GNOME 48-51 run only in CI"
fi
echo "precheck: all passed"
