#!/bin/sh
# Runs smoke.sh in the containers CI uses (gnome.yml), one GNOME version at
# a time, with podman. Each version's image is built once with deps.sh and
# then reused. Needs target/release/noktad and the packed extension
# (tools/precheck.sh builds both).
# Usage: matrix.sh [46 48 49 50 51]   (default: all)
# Logs and shots: build/matrix/<version>/
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VERSIONS=${*:-46 48 49 50 51}

image_of() {
    case "$1" in
        46) echo "ubuntu:24.04 debian" ;;
        48) echo "debian:trixie debian" ;;
        49) echo "fedora:43 fedora" ;;
        50) echo "fedora:44 fedora" ;;
        51) echo "fedora:45 fedora" ;;
        *) return 1 ;;
    esac
}

for need in "$ROOT/target/release/noktad" "$ROOT/build/nokta@nokta.io.shell-extension.zip"; do
    if [ ! -e "$need" ]; then
        echo "matrix: missing $need; run tools/precheck.sh or build it first" >&2
        exit 1
    fi
done

failed=""
for version in $VERSIONS; do
    if ! pair=$(image_of "$version"); then
        echo "matrix: no GNOME $version in CI's matrix" >&2
        exit 2
    fi
    base=${pair% *}
    family=${pair#* }
    tag="localhost/nokta-gnome:$version"
    out="$ROOT/build/matrix/$version"
    rm -rf "$out" "$ROOT/build/shots" "$ROOT/build/devshell"
    mkdir -p "$out"
    # Rebuilt when deps.sh changes, so the image matches what CI installs.
    sum=$(sha256sum "$ROOT/tools/devshell/deps.sh" | cut -c1-12)
    if [ "$(podman image inspect --format '{{index .Labels "deps"}}' "$tag" 2>/dev/null)" != "$sum" ]; then
        echo "matrix: building the GNOME $version image ($base)"
        printf 'FROM %s\nLABEL deps=%s\nCOPY deps.sh /deps.sh\nRUN /deps.sh %s\n' \
            "$base" "$sum" "$family" |
            podman build -t "$tag" -f - "$ROOT/tools/devshell" > "$out/image.log" 2>&1 || {
            echo "matrix: the GNOME $version image did not build, see $out/image.log" >&2
            exit 1
        }
    fi
    echo "matrix: GNOME $version"
    if podman run --rm -v "$ROOT:/nokta:Z" -w /nokta "$tag" tools/devshell/smoke.sh \
        > "$out/smoke.log" 2>&1; then
        echo "matrix: GNOME $version ok"
    else
        echo "matrix: GNOME $version FAILED:"
        grep -E "smoke: (FAIL|error)" "$out/smoke.log" | tail -5 || tail -5 "$out/smoke.log"
        failed="$failed $version"
    fi
    cp -r "$ROOT/build/shots" "$out/shots" 2>/dev/null || true
    cp "$ROOT"/build/devshell/*.log "$ROOT/build/smoke-run.log" "$out/" 2>/dev/null || true
    if grep -qs "JS ERROR" "$out"/*.log; then
        echo "matrix: GNOME $version logged a JS ERROR (see $out)"
        failed="$failed $version"
    fi
done

if [ -n "$failed" ]; then
    echo "matrix: failed on GNOME$failed"
    exit 1
fi
echo "matrix: all passed ($VERSIONS)"
