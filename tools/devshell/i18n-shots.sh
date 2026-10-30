#!/bin/sh
# Starts the devshell in Indonesian, checks that home, Nokta's settings page
# and the settings window are translated, and stops it again. Screenshots go
# to build/shots/i18n-*.png. CI runs it after smoke.sh for every GNOME
# version. Needs target/release/noktad, the packed extension and the en_US
# locale.
#
# The language comes from LANGUAGE under an English locale. gettext ignores
# LANGUAGE under C and C.UTF-8, and GLib translates nothing under id_ID while
# GNOME Shell itself has no Indonesian, as in containers without
# /usr/share/locale.
# Usage: tools/devshell/i18n-shots.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
STATE="$ROOT/build/devshell"

fail() {
    echo "i18n: FAIL: $*" >&2
    exit 1
}
ok() { echo "i18n: ok: $*"; }

locale -a | tr '[:upper:]' '[:lower:]' | grep -qx 'en_us.utf-\{0,1\}8' ||
    fail "the en_US.UTF-8 locale is not installed (locale -a)"
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 LANGUAGE=id

mkdir -p "$ROOT/build"
"$HERE/run.sh" > "$ROOT/build/i18n-run.log" 2>&1 &
RUN=$!
trap '"$HERE/stop.sh" > /dev/null 2>&1 || kill "$RUN" 2> /dev/null || true' EXIT
i=0
until [ -f "$STATE/bus" ]; do
    kill -0 "$RUN" 2> /dev/null || fail "the devshell stopped, see build/i18n-run.log"
    i=$((i + 1))
    [ "$i" -le 120 ] || fail "the devshell did not start within 120 s"
    sleep 1
done
# shellcheck source=tools/devshell/env.sh
. "$HERE/env.sh"

js() {
    out=$(shell_eval "$1")
    case "$out" in
        "(true, '"*) ;;
        *) fail "Eval failed: $out" ;;
    esac
    out=${out#"(true, '"}
    printf '%s\n' "${out%"')"}"
}
wait_for() {
    i=0
    until [ "$(js "$2" 2> /dev/null)" = true ]; do
        i=$((i + 1))
        [ "$i" -le $(($3 * 5)) ] || fail "$1${4:+: $(js "$4" 2> /dev/null)}"
        sleep 0.2
    done
    ok "$1"
}
FIND='const find = (a, cls, out = []) => {
    if (a.has_style_class_name && a.has_style_class_name(cls)) out.push(a);
    for (const c of a.get_children()) find(c, cls, out);
    return out;
};
const one = (cls) => find(Main.layoutManager.uiGroup, cls)[0];
const shown = (cls) => one(cls)?.mapped === true;
const any = (cls) => find(Main.layoutManager.uiGroup, cls).some((a) => a.mapped);
const labels = (cls) => find(Main.layoutManager.uiGroup, cls).filter((a) => a.mapped).map((a) => a.text).join(",");'

wait_for "the extension is active" "Main.extensionManager.lookup('nokta@nokta.io')?.state === 1" 60
"$HERE/player.sh" Stopped > /dev/null
# Hovering opens home only once the notch has gone idle.
wait_for "the idle notch shows the clock" "$FIND shown('nokta-clock')" 10
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
    --method io.nokta.Settings1.Set home tiles "<['timer', 'settings']>" > /dev/null
"$HERE/hover.sh" on > /dev/null
wait_for "home names its tiles in Indonesian" \
    "$FIND shown('nokta-panel') && labels('nokta-tile-label') === 'Timer,Pengaturan'" 10 \
    "$FIND labels('nokta-tile-label')"
sleep 0.4
"$HERE/shot.sh" i18n-home > /dev/null

js "$FIND find(one('nokta-panel-tiles'), 'nokta-tile')[1].emit('clicked', 1); true" > /dev/null
TITLE="find(Main.layoutManager.uiGroup, 'nokta-subpage-title').find((a) => a.mapped)?.text"
MOTION="find(Main.layoutManager.uiGroup, 'nokta-settings-motion-button').filter((a) => a.mapped).map((a) => a.label).join(',')"
wait_for "the settings page is in Indonesian" \
    "$FIND $TITLE === 'Pengaturan' && $MOTION === 'Cepat,Normal,Lambat'" 5 \
    "$FIND JSON.stringify([$TITLE, $MOTION])"
sleep 0.4
"$HERE/shot.sh" i18n-settings > /dev/null
"$HERE/hover.sh" off > /dev/null

# The tour's longest steps, in Indonesian.
wait_for "the notch closes" "$FIND shown('nokta-clock')" 10
TOUR_TITLE="find(Main.layoutManager.uiGroup, 'nokta-tour-title').find((a) => a.mapped)?.text"
js "Main.extensionManager.lookup('nokta@nokta.io').stateObj.getSettings().set_boolean('tour-shown', false); true" > /dev/null
wait_for "the tour is in Indonesian" "$FIND $TOUR_TITLE === 'Ini Nokta' && one('nokta-tour-next').label === 'Lanjut'" 5 "$FIND $TOUR_TITLE"
sleep 0.4
"$HERE/shot.sh" i18n-tour > /dev/null
"$HERE/keys.sh" Return
"$HERE/keys.sh" Return
wait_for "its home step too" "$FIND $TOUR_TITLE === 'Beranda'" 5 "$FIND $TOUR_TITLE"
"$HERE/shot.sh" i18n-tour-home > /dev/null
"$HERE/keys.sh" Escape
wait_for "Escape skips it" "$FIND !shown('nokta-tour')" 5

# GNOME 50 can bring the startup overview back, which hides every window.
js "Main.overview.hide(); true" > /dev/null
wait_for "the overview is closed" "!Main.overview.visible" 10
"$HERE/prefs.sh"
# The windows the shell has, printed when the settings window does not open.
WINDOWS="JSON.stringify({overview: Main.overview.visible, group: global.window_group.visible, windows: global.get_window_actors().map((w) => [w.meta_window.get_title(), w.mapped, w.visible, w.opacity, w.meta_window.minimized, w.meta_window.get_workspace()?.index(), global.workspace_manager.get_active_workspace_index()].join(' '))})"
wait_for "the settings window opens" \
    "global.get_window_actors().some((w) => w.meta_window.get_title() === 'Nokta' && w.mapped && w.opacity === 255)" 30 \
    "$WINDOWS"
sleep 2
"$HERE/shot.sh" i18n-prefs > /dev/null

"$HERE/stop.sh"
trap - EXIT
if grep -E "JS (ERROR|WARNING)|Gjs-CRITICAL" -A3 "$STATE/shell.log" "$STATE/prefs.log" | grep -q "nokta@nokta\.io"; then
    fail "Nokta logged errors, see build/devshell/shell.log and prefs.log"
fi
ok "no errors from Nokta in the logs"
echo "i18n: all checks passed"
