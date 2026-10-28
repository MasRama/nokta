#!/usr/bin/env bash
# Removes what install.sh installed. Your config and cache stay unless --purge.
#
# Usage: uninstall.sh [--prefix-dir DIR] [--purge]
#   --prefix-dir DIR  the directory given to install.sh, if any
#   --purge           also delete config (config.toml) and cache (art, lyrics)
#
# Environment:
#   NOKTA_SKIP_SYSTEMD=1  do not talk to systemd or the session bus (dry runs)
set -euo pipefail

die() { echo "uninstall.sh: $*" >&2; exit 1; }

[[ $(id -u) -ne 0 ]] || die "run this as your normal user, not as root"

prefix=""
purge=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix-dir) [[ $# -ge 2 ]] || die "--prefix-dir needs a directory"; prefix="$2"; shift 2 ;;
    --purge) purge=1; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1'" ;;
  esac
done

if [[ -n "$prefix" ]]; then
  bin_dir="$prefix/.local/bin"
  data_dir="$prefix/.local/share"
  config_dir="$prefix/.config"
  cache_dir="$prefix/.cache"
else
  bin_dir="$HOME/.local/bin"
  data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
  config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
  cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}"
fi

skip_systemd="${NOKTA_SKIP_SYSTEMD:-0}"

if [[ "$skip_systemd" != 1 ]]; then
  systemctl --user stop nokta.service 2>/dev/null || true
fi

if [[ -z "$prefix" && "$skip_systemd" != 1 ]] && command -v gnome-extensions >/dev/null 2>&1; then
  if gnome-extensions info nokta@nokta.io >/dev/null 2>&1; then
    gnome-extensions uninstall nokta@nokta.io && echo "Removed the GNOME extension nokta@nokta.io"
  fi
fi

for file in "$bin_dir/noktad" "$bin_dir/nokta" "$config_dir/systemd/user/nokta.service" \
            "$data_dir/dbus-1/services/io.nokta.Nokta.service"; do
  if [[ -e "$file" ]]; then
    rm -f "$file"
    echo "Removed $file"
  fi
done

if [[ "$skip_systemd" != 1 ]]; then
  systemctl --user daemon-reload
  busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig \
    >/dev/null 2>&1 || true
fi

if [[ $purge -eq 1 ]]; then
  rm -rf "$config_dir/nokta" "$cache_dir/nokta"
  echo "Removed $config_dir/nokta and $cache_dir/nokta"
else
  echo "Kept $config_dir/nokta and $cache_dir/nokta (use --purge to delete them)"
fi
