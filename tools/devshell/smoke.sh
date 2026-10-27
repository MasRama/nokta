#!/bin/sh
# Starts the devshell, checks that Nokta works in this GNOME Shell, and stops
# it again. CI runs it in a container for every GNOME version (GNOME
# versions spec, section 3). Screenshots of each step go to
# build/shots/smoke-*.png. Exits non-zero at the first failed check.
# Usage: tools/devshell/smoke.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
STATE="$ROOT/build/devshell"

fail() {
    echo "smoke: FAIL: $*" >&2
    exit 1
}
ok() { echo "smoke: ok: $*"; }

mkdir -p "$ROOT/build"
"$HERE/run.sh" > "$ROOT/build/smoke-run.log" 2>&1 &
RUN=$!
trap '"$HERE/stop.sh" > /dev/null 2>&1 || kill "$RUN" 2> /dev/null || true' EXIT
i=0
until [ -f "$STATE/bus" ]; do
    kill -0 "$RUN" 2> /dev/null || fail "the devshell stopped, see build/smoke-run.log"
    i=$((i + 1))
    [ "$i" -le 120 ] || fail "the devshell did not start within 120 s"
    sleep 1
done
# shellcheck source=tools/devshell/env.sh
. "$HERE/env.sh"
gnome-shell --version

# Runs JavaScript in the shell and prints its JSON result without the
# GVariant wrapping, or fails when it throws.
js() {
    out=$(shell_eval "$1")
    case "$out" in
        "(true, '"*) ;;
        *) fail "Eval failed: $out" ;;
    esac
    out=${out#"(true, '"}
    printf '%s\n' "${out%"')"}"
}

# Waits up to $3 seconds until the JavaScript $2 returns true. Eval fails
# while the shell is still starting, so a failure there only means "not yet".
wait_for() {
    i=0
    until [ "$(js "$2" 2> /dev/null)" = true ]; do
        i=$((i + 1))
        [ "$i" -le $(($3 * 5)) ] || fail "$1"
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
const width = () => Math.round(one("nokta-body")?.width ?? -1);'

wait_for "the extension is active" \
    "Main.extensionManager.lookup('nokta@nokta.io')?.state === 1" 60
wait_for "a playing track shows in a 260 px notch" \
    "$FIND shown('nokta-collapsed') && width() === 260" 20
"$HERE/shot.sh" smoke-playing > /dev/null

"$HERE/player.sh" Stopped > /dev/null
wait_for "the idle notch shows the clock in 180 px" \
    "$FIND shown('nokta-clock') && /^[0-9]{1,2}:[0-9]{2}/.test(one('nokta-clock').text) && width() === 180" 10
"$HERE/shot.sh" smoke-idle > /dev/null

"$HERE/osd.sh" level audio-volume-medium-symbolic 0.5
wait_for "a volume OSD shows in a 300 px notch" "$FIND shown('nokta-osd') && width() === 300" 5
"$HERE/shot.sh" smoke-osd > /dev/null
wait_for "the OSD goes away" "$FIND !shown('nokta-osd') && width() === 180" 10

"$HERE/timer.sh" start focus
wait_for "a focus timer replaces the clock" \
    "$FIND shown('nokta-timer') && !shown('nokta-clock') && /^2[45]:[0-9]{2}$/.test(one('nokta-timer').text)" 10
"$HERE/shot.sh" smoke-timer > /dev/null
"$HERE/timer.sh" stop
wait_for "the clock comes back when the timer stops" "$FIND shown('nokta-clock') && !shown('nokta-timer')" 10

BANNERS="new imports.gi.Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' }).get_boolean('show-banners')"
"$HERE/keys.sh" Super_L Alt_L f
wait_for "the shortcut starts focus and banners go quiet" "$FIND shown('nokta-timer') && !($BANNERS)" 10
"$HERE/keys.sh" Super_L Alt_L f
wait_for "the shortcut stops the timer and banners come back" "$FIND shown('nokta-clock') && $BANNERS" 10

"$HERE/prefs.sh"
# A window actor exists before its first frame; the map animation fades it in.
wait_for "the settings window opens" \
    "global.get_window_actors().some((w) => w.meta_window.get_title() === 'Nokta' && w.mapped && w.opacity === 255)" 30
sleep 2
"$HERE/shot.sh" smoke-prefs > /dev/null

# Stop the shell first: shutting down must not log errors either.
"$HERE/stop.sh"
trap - EXIT
# JS ERROR, JS WARNING and Gjs-CRITICAL blocks (the line and its stack) that
# come from Nokta.
problems=$(awk '/JS (ERROR|WARNING)|Gjs-CRITICAL/ { block = 1; text = "" }
    block { text = text $0 "\n" }
    block && !/JS (ERROR|WARNING)|Gjs-CRITICAL|Stack trace/ && !/@|#[0-9]/ { block = 0 }
    block && /nokta@nokta\.io/ { print text; block = 0 }' "$STATE/shell.log" "$STATE/prefs.log")
[ -z "$problems" ] || fail "Nokta logged errors:
$problems"
ok "no errors from Nokta in the logs"
echo "smoke: all checks passed"
