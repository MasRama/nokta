#!/bin/sh
# Takes the README's screenshots in the devshell, in English, and saves them
# to docs/images/. The README shows them two per row, so each pair has the
# same height. Needs target/release/noktad and the packed extension.
# Usage: tools/devshell/readme-shots.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
STATE="$ROOT/build/devshell"
OUT="$ROOT/docs/images"

fail() {
    echo "readme-shots: $*" >&2
    exit 1
}

mkdir -p "$ROOT/build" "$OUT"
LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 "$HERE/run.sh" > "$ROOT/build/readme-shots-run.log" 2>&1 &
RUN=$!
trap '"$HERE/stop.sh" > /dev/null 2>&1 || kill "$RUN" 2> /dev/null || true' EXIT
i=0
until [ -f "$STATE/bus" ]; do
    kill -0 "$RUN" 2> /dev/null || fail "the devshell stopped, see build/readme-shots-run.log"
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
        *) fail "eval failed: $out" ;;
    esac
}
wait_for() {
    i=0
    until [ "$(shell_eval "$2" 2> /dev/null)" = "(true, 'true')" ]; do
        i=$((i + 1))
        [ "$i" -le $(($3 * 5)) ] || fail "never got there: $1"
        sleep 0.2
    done
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
set_key() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
        --method io.nokta.Settings1.Set "$1" "$2" "$3" > /dev/null
}
# Saves the top center of the screen, 720 px wide and $2 px tall, once the
# notch has finished moving.
shot() {
    sleep 0.6
    "$HERE/shot.sh" readme > /dev/null
    python3 - "$ROOT/build/shots/readme.png" "$OUT/$1.png" "$2" <<'PY'
import sys
from PIL import Image
image = Image.open(sys.argv[1])
center = image.width // 2
image.crop((center - 360, 0, center + 360, int(sys.argv[3]))).save(sys.argv[2], optimize=True)
PY
    echo "readme-shots: docs/images/$1.png"
}
copy_text() {
    js "imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD, '$1'); true"
    sleep 0.3
}
# A picture made in the shell, so the devshell needs no image files.
picture() {
    python3 - "$1" "$2" "$3" <<'PY'
import sys
from PIL import Image
width, height = 320, 220
image = Image.new('RGB', (width, height))
pixels = image.load()
top, bottom = sys.argv[2].split(','), sys.argv[3].split(',')
for y in range(height):
    t = y / (height - 1)
    color = tuple(int(int(a) + (int(b) - int(a)) * t) for a, b in zip(top, bottom))
    for x in range(width):
        pixels[x, y] = color
image.save(sys.argv[1])
PY
}

wait_for "the extension is active" "Main.extensionManager.lookup('nokta@nokta.io')?.state === 1" 60
wait_for "a playing track" "$FIND shown('nokta-collapsed') && width() === 260" 20
set_key weather location "<'Jakarta'>"

# The player and its lyrics.
"$HERE/hover.sh" on > /dev/null
wait_for "the player" "$FIND shown('nokta-expanded') && shown('nokta-lyric') && one('nokta-lyric').text.length > 0" 15
shot player 360
js "$FIND one('nokta-lyric-button').emit('clicked', 1); true"
wait_for "the lyrics" "$FIND shown('nokta-lyrics-current') && Math.round(one('nokta-body').height) === 336" 5
shot lyrics 360

# Full-screen lyrics at the Korean line, the whole monitor scaled down.
gdbus call --session --dest org.mpris.MediaPlayer2.noktafake --object-path /org/mpris/MediaPlayer2 \
    --method org.mpris.MediaPlayer2.Player.SetPosition /io/nokta/devshell/track/1 61000000 > /dev/null
wait_for "the Korean line" "$FIND one('nokta-lyrics-current').text === 'Turn it up, 사랑해'" 5
js "$FIND one('nokta-lyrics-fullscreen-button').emit('clicked', 1); true"
wait_for "full-screen lyrics" "$FIND shown('nokta-lyrics-fullscreen') && one('nokta-lyrics-fullscreen').opacity === 255" 5
sleep 1.5
"$HERE/shot.sh" readme > /dev/null
python3 - "$ROOT/build/shots/readme.png" "$OUT/fullscreen-lyrics.png" <<'PY'
import sys
from PIL import Image
Image.open(sys.argv[1]).resize((1280, 720), Image.LANCZOS).save(sys.argv[2], optimize=True)
PY
echo "readme-shots: docs/images/fullscreen-lyrics.png"
"$HERE/keys.sh" Escape
wait_for "full-screen lyrics close" "$FIND !any('nokta-lyrics-fullscreen')" 5
"$HERE/hover.sh" off > /dev/null
wait_for "the player closes" "$FIND shown('nokta-collapsed') && width() === 260" 10

# Small ones: the closed notch while a song plays, and the volume.
shot collapsed 120
"$HERE/osd.sh" level audio-volume-medium-symbolic 0.6
wait_for "the volume" "$FIND shown('nokta-osd') && width() === 300" 5
shot osd 120
wait_for "the volume goes" "$FIND !shown('nokta-osd')" 10
"$HERE/device.sh" connect "Galaxy Buds2 Pro" 80
wait_for "the earbuds" "$FIND shown('nokta-osd')" 5
shot device-alert 120
wait_for "the alert goes" "$FIND !shown('nokta-osd')" 10
"$HERE/timer.sh" start focus
wait_for "the focus timer" "$FIND any('nokta-timer')" 10
shot focus-timer 120

# Home with nothing playing: the weather, the next event and the shelf.
"$HERE/timer.sh" stop
"$HERE/player.sh" Stopped
wait_for "the clock" "$FIND shown('nokta-clock')" 10
EVENTS="Main.panel.statusArea.dateMenu._eventSource"
js "const now = Date.now(); $EVENTS.getEvents = () => [{ id: ['smoke-work', 'review', ''].join(String.fromCharCode(10)), date: new Date(now + 25 * 60000), end: new Date(now + 55 * 60000), summary: 'Design review' }, { id: ['smoke-src', 'lunch', ''].join(String.fromCharCode(10)), date: new Date(now + 150 * 60000), end: new Date(now + 210 * 60000), summary: 'Lunch with Dinda' }, { id: ['smoke-home', 'sync', ''].join(String.fromCharCode(10)), date: new Date(now + 300 * 60000), end: new Date(now + 330 * 60000), summary: 'Weekly sync' }]; $EVENTS.emit('changed'); true"
mkdir -p "$STATE/files"
picture "$STATE/files/Sunset.png" 250,140,90 90,60,140
picture "$STATE/files/Lagoon.png" 60,170,200 20,70,120
echo "notes" > "$STATE/files/Notes.txt"
URIS="['file://$STATE/files/Sunset.png', 'file://$STATE/files/Lagoon.png', 'file://$STATE/files/Notes.txt']"
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Shelf \
    --method io.nokta.Shelf1.Add "$URIS" > /dev/null
"$HERE/hover.sh" on > /dev/null
wait_for "home" "$FIND shown('nokta-panel') && shown('nokta-panel-weather') && shown('nokta-panel-event') && find(Main.layoutManager.uiGroup, 'nokta-shelf-thumbnail').filter((t) => t.mapped).length === 2" 15
shot home 360

# The clipboard history, opened from home.
"$HERE/hover.sh" off > /dev/null
copy_text "Meeting moved to 3 pm, room 4B"
copy_text "https://github.com/MasRama/nokta"
picture "$STATE/files/copied.png" 240,120,60 120,40,110
B64=$(base64 -w0 "$STATE/files/copied.png")
js "const { GLib, St } = imports.gi; St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(GLib.base64_decode('$B64'))); true"
sleep 0.3
copy_text "git push origin main"
"$HERE/hover.sh" on > /dev/null
TILE="find(one('nokta-panel-tiles'), 'nokta-tile').find((t) => find(t, 'nokta-tile-label')[0]?.text === 'Clipboard')"
wait_for "the clipboard tile" "$FIND shown('nokta-panel') && $TILE?.mapped === true" 10
js "$FIND $TILE.emit('clicked', 1); true"
wait_for "the clipboard" "$FIND shown('nokta-subpage') && find(Main.layoutManager.uiGroup, 'nokta-clip-entry').filter((e) => e.mapped).length === 4" 5
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-clip-pin').filter((e) => e.mapped)[3].emit('clicked', 1); true"
shot clipboard 260
"$HERE/hover.sh" off > /dev/null
js "delete $EVENTS.getEvents; $EVENTS.emit('changed'); true"
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Shelf --method io.nokta.Shelf1.Clear > /dev/null

# A notification and a live activity.
wait_for "the clock again" "$FIND shown('nokta-clock')" 10
gdbus call --session --dest org.gnome.Shell \
    --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify \
    "Messages" "uint32 0" "mail-unread-symbolic" "Dinda" "Are we still on for lunch?" \
    "@as []" "@a{sv} {}" "int32 -1" > /dev/null
wait_for "the notification" "$FIND shown('nokta-notification')" 10
shot notification 120
wait_for "the notification goes" "$FIND !shown('nokta-notification')" 15
"$HERE/activity.sh" set build "cargo build" "nokta-core" 0.65
wait_for "the activity" "$FIND shown('nokta-activity-badge')" 10
shot activity 120
"$HERE/activity.sh" end build ok ""
wait_for "the activity ends" "$FIND shown('nokta-clock')" 15

# Two of the themes, on the open player.
"$HERE/player.sh" Playing
wait_for "playing again" "$FIND shown('nokta-collapsed') && width() === 260" 10
for theme in glass paper; do
    set_key appearance theme "<'$theme'>"
    "$HERE/hover.sh" on > /dev/null
    wait_for "the player in $theme" "$FIND shown('nokta-expanded') && shown('nokta-lyric')" 10
    shot "theme-$theme" 340
    "$HERE/hover.sh" off > /dev/null
    wait_for "the player closes" "$FIND shown('nokta-collapsed')" 10
done
set_key appearance theme "<'midnight'>"

# A picture of your own behind the notch, and the cover behind the player.
python3 - "$STATE/files/Dusk.png" <<'PY'
import math, sys
from PIL import Image, ImageDraw, ImageFilter
width, height = 1200, 600
image = Image.new('RGB', (width, height))
draw = ImageDraw.Draw(image)
for y in range(height):
    t = y / (height - 1)
    top, bottom = (38, 32, 92), (238, 128, 92)
    draw.line([(0, y), (width, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
draw.ellipse((520, 300, 680, 460), fill=(255, 210, 150))
for i, (base, color) in enumerate([(430, (70, 44, 96)), (480, (44, 28, 70)), (530, (24, 16, 44))]):
    points = [(x, base - 50 * math.sin(x / (170 + 60 * i) + i * 1.7)) for x in range(0, width + 1, 10)]
    draw.polygon(points + [(width, height), (0, height)], fill=color)
image.filter(ImageFilter.GaussianBlur(1)).save(sys.argv[1])
PY
set_key appearance picture "<'$STATE/files/Dusk.png'>"
set_key appearance theme "<'picture'>"
"$HERE/hover.sh" on > /dev/null
wait_for "the player on the picture" "$FIND shown('nokta-expanded') && shown('nokta-picture') && one('nokta-picture').opacity === 255" 10
shot picture 340
"$HERE/hover.sh" off > /dev/null
wait_for "the player closes" "$FIND shown('nokta-collapsed')" 10
set_key appearance theme "<'midnight'>"
set_key appearance picture "<''>"
set_key appearance cover_backdrop "<true>"
"$HERE/hover.sh" on > /dev/null
wait_for "the player on its cover" "$FIND shown('nokta-expanded') && shown('nokta-picture') && one('nokta-picture').opacity === 255" 10
shot backdrop 340
"$HERE/hover.sh" off > /dev/null
wait_for "the player closes" "$FIND shown('nokta-collapsed')" 10
set_key appearance cover_backdrop "<false>"

# The settings page home's Settings tile opens, and the settings window.
# While nothing plays, the open notch is home.
"$HERE/player.sh" Stopped
wait_for "the clock" "$FIND shown('nokta-clock')" 10
"$HERE/hover.sh" on > /dev/null
TILE="find(one('nokta-panel-tiles'), 'nokta-tile').find((t) => find(t, 'nokta-tile-label')[0]?.text === 'Settings')"
wait_for "the settings tile" "$FIND shown('nokta-panel') && $TILE?.mapped === true" 10
js "$FIND $TILE.emit('clicked', 1); true"
wait_for "the settings page" "$FIND any('nokta-subpage') && find(Main.layoutManager.uiGroup, 'nokta-settings-theme').filter((b) => b.mapped).length === 7" 5
shot settings-page 330
"$HERE/hover.sh" off > /dev/null
wait_for "the notch closes" "$FIND !any('nokta-subpage')" 10
"$HERE/prefs.sh"
PREFS="global.get_window_actors().find((w) => w.meta_window.get_title() === 'Nokta')"
wait_for "the settings window" "$PREFS?.mapped === true && $PREFS.opacity === 255" 30
sleep 1.5
# The window's frame, without its shadow.
RECT=$(shell_eval "const r = $PREFS.meta_window.get_frame_rect(); [r.x, r.y, r.width, r.height].join(' ')" | grep -oE '[0-9]+' | tr '\n' ' ')
"$HERE/shot.sh" readme > /dev/null
python3 - "$ROOT/build/shots/readme.png" "$OUT/settings-window.png" "$RECT" <<'PY'
import sys
from PIL import Image
x, y, w, h = map(int, sys.argv[3].split())
Image.open(sys.argv[1]).crop((x, y, x + w, y + h)).save(sys.argv[2], optimize=True)
PY
echo "readme-shots: docs/images/settings-window.png"
echo "readme-shots: done"
