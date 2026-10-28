#!/usr/bin/env bash
# Installs noktad, the nokta command and the Nokta GNOME extension for the
# current user.
# Nothing is written outside your home directory and sudo is never used.
#
# Usage: install.sh [--prefix-dir DIR]
#   --prefix-dir DIR  install under DIR instead of your home directory
#
# Environment:
#   NOKTA_SKIP_SYSTEMD=1  do not talk to systemd or the session bus (dry runs)
set -euo pipefail

die() { echo "install.sh: $*" >&2; exit 1; }

[[ $(id -u) -ne 0 ]] || die "run this as your normal user, not as root"

prefix=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix-dir) [[ $# -ge 2 ]] || die "--prefix-dir needs a directory"; prefix="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1'" ;;
  esac
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "$prefix" ]]; then
  mkdir -p "$prefix"
  prefix="$(cd "$prefix" && pwd)"
  bin_dir="$prefix/.local/bin"
  data_dir="$prefix/.local/share"
  config_dir="$prefix/.config"
else
  bin_dir="$HOME/.local/bin"
  data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
  config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
fi
unit_dir="$config_dir/systemd/user"
dbus_dir="$data_dir/dbus-1/services"

# A release archive has everything next to this script; a source checkout has
# the units here and the binary in target/release.
find_first() {
  local candidate
  for candidate in "$@"; do
    [[ -f "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}
noktad="$(find_first "$here/noktad" "$here/../target/release/noktad")" \
  || die "noktad not found next to this script or in target/release (run: cargo build --release)"
nokta="$(find_first "$here/nokta" "$here/../target/release/nokta")" \
  || die "nokta not found next to this script or in target/release (run: cargo build --release)"
unit_src="$(find_first "$here/nokta.service" "$here/packaging/nokta.service")" \
  || die "nokta.service not found"
dbus_src="$(find_first "$here/io.nokta.Nokta.service" "$here/packaging/io.nokta.Nokta.service")" \
  || die "io.nokta.Nokta.service not found"

# Copy then rename, so a running noktad is never overwritten in place.
put() {
  local src="$1" dest="$2" mode="$3"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest.tmp"
  chmod "$mode" "$dest.tmp"
  mv -f "$dest.tmp" "$dest"
}
render() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  sed "s|@BINDIR@|$bin_dir|g" "$src" > "$dest.tmp"
  chmod 644 "$dest.tmp"
  mv -f "$dest.tmp" "$dest"
}

put "$noktad" "$bin_dir/noktad" 755
put "$nokta" "$bin_dir/nokta" 755
render "$unit_src" "$unit_dir/nokta.service"
render "$dbus_src" "$dbus_dir/io.nokta.Nokta.service"
echo "Installed noktad and nokta to $bin_dir"
echo "Installed nokta.service to $unit_dir"
echo "Installed D-Bus activation to $dbus_dir"

if [[ "${NOKTA_SKIP_SYSTEMD:-0}" != 1 ]]; then
  systemctl --user daemon-reload
  # Picks up the new activation file without a new login, where the bus allows it.
  busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig \
    >/dev/null 2>&1 || true
  # An upgrade replaces a running daemon; a fresh install starts on first use.
  systemctl --user try-restart nokta.service || true
fi

zip="$here/nokta@nokta.io.shell-extension.zip"
extension_installed=0
if [[ -f "$zip" && -n "$prefix" ]]; then
  echo "Skipping the GNOME extension: gnome-extensions cannot install into --prefix-dir" >&2
elif [[ -f "$zip" ]]; then
  if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions install --force "$zip"
    extension_installed=1
    echo "Installed the GNOME extension nokta@nokta.io"
  else
    echo "gnome-extensions is not available; install $zip with the Extensions app" >&2
  fi
fi

cat <<NEXT

Next steps:
NEXT
if [[ $extension_installed -eq 1 ]]; then
  cat <<NEXT
  1. Log out and back in (GNOME on Wayland only loads new extensions at login).
  2. Run: gnome-extensions enable nokta@nokta.io
  3. If you use Just Perfection, set its clock position to Right.
NEXT
else
  cat <<NEXT
  Install the extension (nokta@nokta.io.shell-extension.zip from the same
  release) with: gnome-extensions install --force nokta@nokta.io.shell-extension.zip
  then log out and back in and run: gnome-extensions enable nokta@nokta.io
NEXT
fi
echo "  Settings live in ${XDG_CONFIG_HOME:-$HOME/.config}/nokta/config.toml (created on first run)."
