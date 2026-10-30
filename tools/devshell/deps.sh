#!/bin/sh
# Installs what smoke.sh and i18n-shots.sh need in a fresh container: GNOME Shell, a session
# bus, PipeWire and the tools the steps use. Shared by CI (gnome.yml) and
# tools/devshell/matrix.sh, so both test the same thing.
# Usage: deps.sh debian|fedora (run as root)
set -eu

case "${1:-}" in
    debian)
        export DEBIAN_FRONTEND=noninteractive
        # A mirror that stalls fails one try, not the run.
        RETRY="-o Acquire::Retries=5"
        # shellcheck disable=SC2086
        apt-get $RETRY update
        # shellcheck disable=SC2086
        apt-get $RETRY install -y --no-install-recommends gnome-shell gnome-shell-common \
            dbus-daemon libglib2.0-bin gjs gir1.2-adw-1 gir1.2-gtk-4.0 \
            libgl1-mesa-dri adwaita-icon-theme python3 python3-pil unzip \
            pipewire pipewire-pulse pipewire-bin locales
        # i18n-shots.sh runs the shell in Indonesian under an English locale.
        localedef -i en_US -f UTF-8 en_US.UTF-8
        ;;
    fedora)
        # openh264 comes from Cisco's mirror, which stalls now and then;
        # nothing here needs it.
        dnf install -y --setopt=install_weak_deps=False --setopt=retries=10 \
            --disablerepo='fedora-cisco-openh264' \
            gnome-shell dbus-daemon glib2 gjs libadwaita gtk4 mesa-dri-drivers \
            adwaita-icon-theme python3 python3-pillow unzip pipewire \
            pipewire-pulseaudio pipewire-utils glibc-langpack-en
        ;;
    *)
        echo "usage: deps.sh debian|fedora" >&2
        exit 2
        ;;
esac
