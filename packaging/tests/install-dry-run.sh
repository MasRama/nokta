#!/usr/bin/env bash
# Installs into a throwaway home and checks every file, then uninstalls.
# Needs target/release/noktad (or NOKTAD pointing at a built binary), with
# the nokta command next to it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
noktad="${NOKTAD:-$root/target/release/noktad}"
[[ -x "$noktad" ]] || { echo "build noktad first: cargo build --release" >&2; exit 1; }
nokta="$(dirname "$noktad")/nokta"
[[ -x "$nokta" ]] || { echo "build nokta first: cargo build --release" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Lay out a release archive: everything next to install.sh.
archive="$work/archive"
mkdir -p "$archive"
cp "$noktad" "$nokta" "$root"/packaging/{install.sh,uninstall.sh,nokta.service,io.nokta.Nokta.service} "$archive/"

home="$work/home"
mkdir -p "$home"
run() { env -u XDG_DATA_HOME -u XDG_CONFIG_HOME -u XDG_CACHE_HOME HOME="$home" NOKTA_SKIP_SYSTEMD=1 "$@" >/dev/null; }

run "$archive/install.sh"
bin="$home/.local/bin/noktad"
cli="$home/.local/bin/nokta"
unit="$home/.config/systemd/user/nokta.service"
dbus="$home/.local/share/dbus-1/services/io.nokta.Nokta.service"
[[ -x "$bin" ]] || fail "noktad not installed"
[[ -x "$cli" ]] || fail "nokta not installed"
grep -qx "ExecStart=$bin" "$unit" || fail "unit ExecStart is not $bin"
grep -qx "Exec=$bin" "$dbus" || fail "D-Bus Exec is not $bin"
grep -qx "SystemdService=nokta.service" "$dbus" || fail "D-Bus file does not name the unit"
! grep -rq "@BINDIR@" "$home" || fail "unrendered @BINDIR@ left behind"
"$bin" --version | grep -q "^noktad " || fail "installed noktad does not run"
"$cli" --version | grep -q "^nokta " || fail "installed nokta does not run"

mkdir -p "$home/.config/nokta" "$home/.cache/nokta"
touch "$home/.config/nokta/config.toml"
run "$archive/uninstall.sh"
[[ ! -e "$bin" && ! -e "$cli" && ! -e "$unit" && ! -e "$dbus" ]] || fail "uninstall left files behind"
[[ -f "$home/.config/nokta/config.toml" ]] || fail "uninstall removed the config without --purge"
run "$archive/uninstall.sh" --purge
[[ ! -e "$home/.config/nokta" && ! -e "$home/.cache/nokta" ]] || fail "--purge kept config or cache"

# A prefix with characters that mean something to sed lands in the units as it is.
odd="$work/odd&dir|x"
run "$archive/install.sh" --prefix-dir "$odd"
grep -qxF "ExecStart=$odd/.local/bin/noktad" "$odd/.config/systemd/user/nokta.service" \
  || fail "unit ExecStart lost the prefix $odd: $(grep ExecStart "$odd/.config/systemd/user/nokta.service")"
grep -qxF "Exec=$odd/.local/bin/noktad" "$odd/.local/share/dbus-1/services/io.nokta.Nokta.service" \
  || fail "D-Bus Exec lost the prefix $odd"

if [[ $(id -u) -ne 0 ]]; then
  ! "$archive/install.sh" --bogus 2>/dev/null || fail "unknown argument accepted"
fi
echo "install dry run: ok"
