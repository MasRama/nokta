#!/bin/sh
# Starts the devshell, checks that Nokta works in this GNOME Shell, and stops
# it again. CI runs it in a container for every GNOME version. Screenshots
# of each step go to build/shots/smoke-*.png. Exits non-zero at the first
# failed check.
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
# On failure it prints the result of the JavaScript $4, when given.
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
const width = () => Math.round(one("nokta-body")?.width ?? -1);'

wait_for "the extension is active" \
    "Main.extensionManager.lookup('nokta@nokta.io')?.state === 1" 60
wait_for "a playing track shows in a 260 px notch" \
    "$FIND shown('nokta-collapsed') && width() === 260" 20
"$HERE/shot.sh" smoke-playing > /dev/null

# Hovering opens the player; the fake player has shuffle and repeat, so both
# buttons show, and a click on repeat reaches it through noktad.
media_prop() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Media \
        --method org.freedesktop.DBus.Properties.Get io.nokta.Media1 "$1"
}
"$HERE/hover.sh" on > /dev/null
wait_for "hovering opens the player with shuffle and repeat" \
    "$FIND shown('nokta-expanded') && find(Main.layoutManager.uiGroup, 'nokta-toggle').filter((b) => b.mapped).length === 2" 10
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-toggle')[1].emit('clicked', 1); true" > /dev/null
i=0
until media_prop LoopStatus | grep -q Playlist; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "repeat did not reach the player: $(media_prop LoopStatus)"
    sleep 0.2
done
ok "the repeat button turns the player's repeat on"
"$HERE/shot.sh" smoke-expanded > /dev/null
# The fake LRCLIB has synced lyrics for the fake track: a click on the lyric
# line opens the lyrics view 150 px taller, a click on it closes it.
wait_for "the open player shows a synced lyric line" "$FIND shown('nokta-lyric') && one('nokta-lyric').text.length > 0" 10
js "$FIND one('nokta-lyric-button').emit('clicked', 1); true" > /dev/null
wait_for "a click on the lyric opens the lyrics view" \
    "$FIND shown('nokta-lyrics-current') && one('nokta-lyrics-current').text.length > 0 && !shown('nokta-lyric') && Math.round(one('nokta-body').height) === 300" 5
"$HERE/shot.sh" smoke-lyrics > /dev/null
js "$FIND one('nokta-lyrics-sheet-button').emit('clicked', 1); true" > /dev/null
wait_for "a click on the lyrics view closes it" \
    "$FIND !shown('nokta-lyrics-sheet') && shown('nokta-lyric') && Math.round(one('nokta-body').height) === 150" 5
"$HERE/hover.sh" off > /dev/null
wait_for "the player closes" "$FIND shown('nokta-collapsed') && width() === 260" 5

"$HERE/player.sh" Stopped > /dev/null
wait_for "the idle notch shows the clock in 180 px" \
    "$FIND shown('nokta-clock') && /^[0-9]{1,2}:[0-9]{2}/.test(one('nokta-clock').text) && width() === 180" 10
"$HERE/shot.sh" smoke-idle > /dev/null

# Hovering the idle notch opens the panel; its notifications button opens
# GNOME's calendar from the top bar and gives the menu back to the clock.
# With a location set, the fake Open-Meteo's weather shows beside the date.
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
    --method io.nokta.Settings1.Set weather location "<'Jakarta'>" > /dev/null
"$HERE/hover.sh" on > /dev/null
wait_for "hovering the idle notch opens the panel with the date" \
    "$FIND shown('nokta-panel') && one('nokta-panel-date').text.length > 0 && width() === 420" 5
wait_for "the panel shows the weather beside the date" \
    "$FIND shown('nokta-panel-weather') && one('nokta-panel-weather-temperature').text === '31°' && one('nokta-panel-weather-detail').text === 'Jakarta · 33° / 25°'" 5 \
    "$FIND JSON.stringify([shown('nokta-panel-weather'), one('nokta-panel-weather-temperature')?.text, one('nokta-panel-weather-detail')?.text])"
"$HERE/shot.sh" smoke-panel > /dev/null
DATE_MENU="Main.panel.statusArea.dateMenu.menu"
js "$FIND one('nokta-panel-button').emit('clicked', 1); true" > /dev/null
wait_for "the notifications button opens GNOME's calendar" "$DATE_MENU.isOpen" 5
js "$DATE_MENU.close(); true" > /dev/null
wait_for "the calendar belongs to the clock again" \
    "!$DATE_MENU.isOpen && $DATE_MENU.sourceActor === Main.panel.statusArea.dateMenu" 5
"$HERE/hover.sh" off > /dev/null
wait_for "the panel closes" "$FIND shown('nokta-clock') && width() === 180" 5

# GNOME's own privacy indicators drive the dots; showing one by hand must
# show a dot. This also checks that this GNOME version has them where Nokta
# looks.
QS="Main.panel.statusArea.quickSettings"
wait_for "GNOME has camera and microphone indicators" \
    "!!($QS._camera?._indicator && $QS._volumeInput?._indicator)" 10
js "$QS._camera._indicator.visible = true; $QS._volumeInput._indicator.visible = true; true" > /dev/null
wait_for "the camera and microphone show two dots" \
    "$FIND find(Main.layoutManager.uiGroup, 'nokta-privacy-dot').filter((d) => d.mapped).length === 2" 5
"$HERE/shot.sh" smoke-privacy > /dev/null
js "$QS._camera._indicator.visible = false; $QS._volumeInput._indicator.visible = false; true" > /dev/null
wait_for "the dots go away" \
    "$FIND find(Main.layoutManager.uiGroup, 'nokta-privacy-dot').every((d) => !d.mapped)" 5

"$HERE/osd.sh" level audio-volume-medium-symbolic 0.5
wait_for "a volume OSD shows in a 300 px notch" "$FIND shown('nokta-osd') && width() === 300" 5
"$HERE/shot.sh" smoke-osd > /dev/null
wait_for "the OSD goes away" "$FIND !shown('nokta-osd') && width() === 180" 10

# A notification GNOME would show as a banner shows in the notch instead.
# This also checks that this GNOME version has the method Nokta wraps. The
# devshell's shell does not own org.freedesktop.Notifications, but serves
# the object on its own connection.
gdbus call --session --dest org.gnome.Shell \
    --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify \
    "Nokta smoke" "uint32 0" "dialog-information-symbolic" "Hello from Nokta" "The body line" \
    "@as []" "@a{sv} {}" "int32 -1" > /dev/null
wait_for "a notification shows in a 420 px notch instead of GNOME's banner" \
    "$FIND shown('nokta-notification') && one('nokta-notification-title').text === 'Hello from Nokta' && width() === 420 && !find(Main.layoutManager.uiGroup, 'notification-banner').some((b) => b.mapped)" 10
"$HERE/shot.sh" smoke-notification > /dev/null
wait_for "the notification goes away" "$FIND !shown('nokta-notification') && width() === 180" 15

"$HERE/timer.sh" start focus
wait_for "a focus timer replaces the clock" \
    "$FIND shown('nokta-timer') && !shown('nokta-clock') && /^2[45]:[0-9]{2}$/.test(one('nokta-timer').text)" 10
"$HERE/shot.sh" smoke-timer > /dev/null
"$HERE/timer.sh" stop
wait_for "the clock comes back when the timer stops" "$FIND shown('nokta-clock') && !shown('nokta-timer')" 10

# A live activity takes the clock's place and gets a row in the panel; its
# end shows like a device alert.
"$HERE/activity.sh" set smoke "Smoke build" "Compiling" 0.4
wait_for "a live activity replaces the clock with its percentage" \
    "$FIND shown('nokta-activity-badge') && !shown('nokta-clock') && one('nokta-activity-badge-label').text === '40%'" 10
"$HERE/shot.sh" smoke-activity > /dev/null
"$HERE/hover.sh" on > /dev/null
# 32 px closed, 58 px for the date and the buttons, 46 px for one activity.
wait_for "the panel grows a row for the activity" \
    "$FIND shown('nokta-panel-activity') && one('nokta-panel-activity-title').text === 'Smoke build' && Math.round(one('nokta-body').height) === 136" 5
"$HERE/shot.sh" smoke-activity-panel > /dev/null
"$HERE/hover.sh" off > /dev/null
wait_for "the panel closes over the activity" "$FIND shown('nokta-activity-badge') && width() === 180" 5
"$HERE/activity.sh" end smoke failed "Disk full"
wait_for "the end of the activity shows as an urgent alert" \
    "$FIND shown('nokta-osd') && one('nokta-osd-text').text === 'Smoke build' && one('nokta-osd-detail').text === 'Disk full' && one('nokta-osd').has_style_class_name('nokta-osd-urgent')" 5
"$HERE/shot.sh" smoke-activity-ended > /dev/null
wait_for "the clock comes back when the activity ends" "$FIND shown('nokta-clock') && !shown('nokta-activity-badge')" 10

# A fake event in the date menu's event source gets a row in the panel, and
# its reminder (5 minutes before, by default) shows like a device alert.
EVENTS="Main.panel.statusArea.dateMenu._eventSource"
js "const now = Date.now(); $EVENTS.getEvents = () => [{ id: 'smoke', date: new Date(now + 5 * 60000 + 8000), end: new Date(now + 35 * 60000), summary: 'Smoke standup' }]; $EVENTS.emit('changed'); true" > /dev/null
"$HERE/hover.sh" on > /dev/null
# 32 px closed, 58 px for the date and the buttons, 28 px for the event.
wait_for "the panel shows the next calendar event" \
    "$FIND shown('nokta-panel-event') && one('nokta-panel-event-title').text === 'Smoke standup' && one('nokta-panel-event-when').text.includes(' · in ') && Math.round(one('nokta-body').height) === 118" 5 \
    "$FIND JSON.stringify([shown('nokta-panel-event'), one('nokta-panel-event-title')?.text, one('nokta-panel-event-when')?.text, Math.round(one('nokta-body').height)])"
"$HERE/shot.sh" smoke-calendar-panel > /dev/null
"$HERE/hover.sh" off > /dev/null
wait_for "the event's reminder shows in the notch" \
    "$FIND shown('nokta-osd') && one('nokta-osd-text').text === 'Smoke standup in 5 min'" 15 \
    "$FIND JSON.stringify([shown('nokta-osd'), one('nokta-osd-text')?.text])"
"$HERE/shot.sh" smoke-calendar-reminder > /dev/null
js "delete $EVENTS.getEvents; $EVENTS.emit('changed'); true" > /dev/null
wait_for "the clock comes back after the reminder" "$FIND shown('nokta-clock')" 10

# A file dragged from an app onto the notch opens the drop area and stays on
# the shelf. The shell's own Wayland client, a dock off every monitor, takes
# the drop and the presses on the shelf row.
shelf_items() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Shelf \
        --method org.freedesktop.DBus.Properties.Get io.nokta.Shelf1 Items
}
point() {
    js "const seat = $SEAT_JS; global._noktaPointer ??= seat.create_virtual_device(imports.gi.Clutter.InputDeviceType.POINTER_DEVICE);
global._noktaPointer.notify_absolute_motion(global.get_current_time() * 1000, $1, $2); true" > /dev/null
}
HELPER="global.get_window_actors().map((a) => a.meta_window).find((w) => w.get_title() === 'nokta-shelf')"
wait_for "the shelf's helper window waits off screen as a dock" \
    "const w = $HELPER; !!w && w.get_window_type() === imports.gi.Meta.WindowType.DOCK && w.get_frame_rect().x === -10000" 15 \
    "const w = $HELPER; JSON.stringify(w ? [w.get_window_type(), w.get_frame_rect().x, w.is_hidden()] : null)"
mkdir -p "$STATE/files"
echo smoke > "$STATE/files/smoke-notes.txt"
"$HERE/drop.sh" --hold "$STATE/files/smoke-notes.txt"
wait_for "dragging a file to the notch opens the drop area" \
    "$FIND shown('nokta-drop') && $HELPER.get_frame_rect().y === 0" 5
"$HERE/shot.sh" smoke-shelf-drop > /dev/null
"$HERE/drop.sh" --release
i=0
until shelf_items | grep -q "smoke-notes.txt', 'text-x-generic'"; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "the dropped file is not on the shelf: $(shelf_items)"
    sleep 0.2
done
ok "the dropped file is on the shelf"
wait_for "the closed notch shows one file on the shelf" \
    "$FIND any('nokta-shelf-badge') && one('nokta-shelf-badge-label').text === '1' && !shown('nokta-clock')" 5
"$HERE/hover.sh" on > /dev/null
# 32 px closed, 58 px for the date and the buttons, 54 px for the shelf row.
wait_for "the panel shows the shelf row" \
    "$FIND any('nokta-shelf-row') && find(Main.layoutManager.uiGroup, 'nokta-shelf-slot').filter((s) => s.mapped).length === 2 && Math.round(one('nokta-body').height) === 144" 5 \
    "$FIND JSON.stringify([any('nokta-shelf-row'), find(Main.layoutManager.uiGroup, 'nokta-shelf-slot').length, Math.round(one('nokta-body').height)])"
# The file's slot, the last one; its close button is in the top right corner.
SLOT=$(js "$FIND const s = find(Main.layoutManager.uiGroup, 'nokta-shelf-slot').filter((s) => s.mapped).pop(); const [x, y] = s.get_transformed_position(); Math.round(x + s.width - 6) + ' ' + Math.round(y + 6)")
SLOT=${SLOT#\"}
SLOT=${SLOT%\"}
point "${SLOT% *}" "${SLOT#* }"
sleep 0.1
point "$((${SLOT% *} - 1))" "${SLOT#* }"
wait_for "the pointer on the file reaches the helper and shows its close button" \
    "$FIND any('nokta-shelf-close') && $HELPER.get_frame_rect().y > 0" 5
"$HERE/shot.sh" smoke-shelf-row > /dev/null
"$HERE/click.sh" "$((${SLOT% *} - 1))" "${SLOT#* }"
i=0
until shelf_items | grep -q '@a(sss) \[\]'; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "the close button did not take the file off the shelf: $(shelf_items)"
    sleep 0.2
done
ok "the close button takes the file off the shelf"
"$HERE/hover.sh" off > /dev/null
wait_for "the clock comes back when the shelf is empty" \
    "$FIND shown('nokta-clock') && !any('nokta-shelf-badge') && $HELPER.get_frame_rect().x === -10000" 10

BANNERS="new imports.gi.Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' }).get_boolean('show-banners')"
"$HERE/keys.sh" Super_L Alt_L f
wait_for "the shortcut starts focus and banners go quiet" "$FIND shown('nokta-timer') && !($BANNERS)" 10
"$HERE/keys.sh" Super_L Alt_L f
wait_for "the shortcut stops the timer and banners come back" "$FIND shown('nokta-clock') && $BANNERS" 10

# On GNOME 49 and later the virtual Super key of the shortcut steps can
# leave the overview open, which hides every window.
js "Main.overview.hide(); true" > /dev/null
wait_for "the overview is closed" "!Main.overview.visible" 10
"$HERE/prefs.sh"
# A window actor exists before its first frame; the map animation fades it in.
# The windows the shell has, printed when the settings window does not open.
WINDOWS="JSON.stringify({overview: Main.overview.visible, group: global.window_group.visible, windows: global.get_window_actors().map((w) => [w.meta_window.get_title(), w.mapped, w.visible, w.opacity, w.meta_window.minimized, w.meta_window.get_workspace()?.index(), global.workspace_manager.get_active_workspace_index()].join(' '))})"
wait_for "the settings window opens" \
    "global.get_window_actors().some((w) => w.meta_window.get_title() === 'Nokta' && w.mapped && w.opacity === 255)" 30 \
    "$WINDOWS"
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
