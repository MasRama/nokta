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

# Checks for $3 whole seconds that the JavaScript $2 stays true, and fails at
# the first moment it is not: for what must not happen. On failure it prints
# the result of the JavaScript $4, when given.
holds() {
    i=0
    while [ "$i" -lt $(($3 * 5)) ]; do
        [ "$(js "$2" 2> /dev/null)" = true ] || fail "$1${4:+: $(js "$4" 2> /dev/null)}"
        i=$((i + 1))
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
# The line along the closed notch runs with the song.
wait_for "the progress line shows the song's position" \
    "$FIND shown('nokta-progress-line') && one('nokta-progress-line-fill').scale_x > 0" 5
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
[ "$(js "$FIND shown('nokta-progress-line')")" = false ] || fail "the progress line shows in the open notch"
# The cover's flight lands and the player's rows end at full strength.
wait_for "the cover's flight lands and the player's rows come in" \
    "$FIND one('nokta-morph').get_n_children() === 0 && one('nokta-expanded').get_children().every((row) => row.opacity === 255 && row.translation_y === 0)" 5 \
    "$FIND JSON.stringify([one('nokta-morph').get_n_children(), one('nokta-expanded').get_children().map((row) => row.opacity)])"
ok "the progress line belongs to the closed notch"
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-toggle')[1].emit('clicked', 1); true" > /dev/null
i=0
until media_prop LoopStatus | grep -q Playlist; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "repeat did not reach the player: $(media_prop LoopStatus)"
    sleep 0.2
done
ok "the repeat button turns the player's repeat on"
"$HERE/shot.sh" smoke-expanded > /dev/null
# The fake LRCLIB has synced lyrics for the fake track: they add a 44 px lyric
# row to the 150 px player, a click on it opens the 336 px lyrics view (with
# its timing row), and a click on that closes it.
wait_for "the open player shows a synced lyric line" "$FIND shown('nokta-lyric') && one('nokta-lyric').text.length > 0" 10
js "$FIND one('nokta-lyric-button').emit('clicked', 1); true" > /dev/null
wait_for "a click on the lyric opens the lyrics view" \
    "$FIND shown('nokta-lyrics-current') && one('nokta-lyrics-current').text.length > 0 && !shown('nokta-lyric') && Math.round(one('nokta-body').height) === 336" 5
wait_for "the lyrics view's timing row says the lyrics are on time" \
    "$FIND shown('nokta-lyrics-footer') && one('nokta-lyrics-offset-label').text === 'On time'" 5
"$HERE/shot.sh" smoke-lyrics > /dev/null
# + shows the lyrics a quarter second earlier: noktad keeps the offset and
# sends the lines shifted (the second line starts at 15 s), and the view
# stays open. A click on the label puts it back.
lyrics_prop() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Lyrics \
        --method org.freedesktop.DBus.Properties.Get io.nokta.Lyrics1 "$1"
}
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-lyrics-step')[1].emit('clicked', 1); true" > /dev/null
wait_for "+ moves the lyrics 0.25 s earlier and keeps the view open" \
    "$FIND one('nokta-lyrics-offset-label').text === '0.25 s earlier' && shown('nokta-lyrics-current') && Math.round(one('nokta-body').height) === 336" 5 \
    "$FIND one('nokta-lyrics-offset-label')?.text"
lyrics_prop OffsetMs | grep -q "<int64 250>" || fail "OffsetMs is not 250: $(lyrics_prop OffsetMs)"
lyrics_prop Lines | grep -q "14750000" || fail "the lines did not move: $(lyrics_prop Lines)"
ok "noktad keeps the offset and shifts the lines"
sleep 0.5
"$HERE/shot.sh" smoke-lyrics-offset > /dev/null
js "$FIND one('nokta-lyrics-offset').emit('clicked', 1); true" > /dev/null
wait_for "a click on the label puts the lyrics back on time" \
    "$FIND one('nokta-lyrics-offset-label').text === 'On time' && shown('nokta-lyrics-current')" 5
lyrics_prop OffsetMs | grep -q "<int64 0>" || fail "OffsetMs is not 0: $(lyrics_prop OffsetMs)"
lyrics_prop Lines | grep -q "15000000" || fail "the lines did not move back: $(lyrics_prop Lines)"
ok "the offset is back to 0"
js "$FIND one('nokta-lyrics-sheet-button').emit('clicked', 1); true" > /dev/null
wait_for "a click on the lyrics view closes it" \
    "$FIND !shown('nokta-lyrics-sheet') && shown('nokta-lyric') && Math.round(one('nokta-body').height) === 194" 5
# A Korean line gets its romanization in the next line's place, offline.
gdbus call --session --dest org.mpris.MediaPlayer2.noktafake --object-path /org/mpris/MediaPlayer2 \
    --method org.mpris.MediaPlayer2.Player.SetPosition /io/nokta/devshell/track/1 61000000 > /dev/null
wait_for "a Korean line shows romanized under it" \
    "$FIND one('nokta-lyric').text === 'Turn it up, 사랑해' && one('nokta-lyric-next').text === 'Turn it up, saranghae' && one('nokta-lyric-next').has_style_class_name('nokta-lyric-romanized') && Math.round(one('nokta-body').height) === 194" 5 \
    "$FIND JSON.stringify([one('nokta-lyric')?.text, one('nokta-lyric-next')?.text, Math.round(one('nokta-body').height)])"
"$HERE/shot.sh" smoke-lyric-romanized > /dev/null
js "$FIND one('nokta-lyric-button').emit('clicked', 1); true" > /dev/null
wait_for "the lyrics view puts it in the row under the line" \
    "$FIND one('nokta-lyrics-current').text === 'Turn it up, 사랑해' && one('nokta-lyrics-romanized').text === 'Turn it up, saranghae' && Math.round(one('nokta-body').height) === 336" 5 \
    "$FIND JSON.stringify([one('nokta-lyrics-current')?.text, one('nokta-lyrics-romanized')?.text])"
"$HERE/shot.sh" smoke-lyrics-romanized > /dev/null
js "$FIND one('nokta-lyrics-sheet-button').emit('clicked', 1); true" > /dev/null
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
    --method io.nokta.Settings1.Set lyrics romanize "<false>" > /dev/null
wait_for "romanize off brings the next line back" \
    "$FIND one('nokta-lyric').text === 'Turn it up, 사랑해' && one('nokta-lyric-next').text === 'Night drive, きみと' && !one('nokta-lyric-next').has_style_class_name('nokta-lyric-romanized')" 5 \
    "$FIND JSON.stringify([one('nokta-lyric')?.text, one('nokta-lyric-next')?.text])"
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
    --method io.nokta.Settings1.Set lyrics romanize "<true>" > /dev/null
# The lyrics view's corner button opens the lyrics full screen over the
# blurred cover, every Korean or Japanese line romanized; Escape closes it
# and gives the keyboard back. The notch closed under it, and opens again
# under the pointer with the player.
gdbus call --session --dest org.mpris.MediaPlayer2.noktafake --object-path /org/mpris/MediaPlayer2 \
    --method org.mpris.MediaPlayer2.Player.SetPosition /io/nokta/devshell/track/1 61000000 > /dev/null
js "$FIND one('nokta-lyric-button').emit('clicked', 1); true" > /dev/null
wait_for "the lyrics view has a full-screen button" "$FIND shown('nokta-lyrics-fullscreen-button')" 5
js "$FIND one('nokta-lyrics-fullscreen-button').emit('clicked', 1); true" > /dev/null
FULL_ROMANIZED="JSON.stringify(find(Main.layoutManager.uiGroup, 'nokta-lyrics-fullscreen-romanized').filter((a) => a.mapped).map((a) => a.text))"
wait_for "full-screen lyrics cover the monitor with the line and its romanizations" \
    "$FIND shown('nokta-lyrics-fullscreen') && one('nokta-lyrics-fullscreen').opacity === 255 && one('nokta-lyrics-fullscreen').width === Main.layoutManager.monitors[0].width && one('nokta-lyrics-fullscreen-current').text === 'Turn it up, 사랑해' && $FULL_ROMANIZED === JSON.stringify(['Turn it up, saranghae', 'Night drive, kimito']) && Main.modalActorFocusStack.some((m) => m.actor === one('nokta-lyrics-fullscreen'))" 5 \
    "$FIND const f = one('nokta-lyrics-fullscreen'); JSON.stringify([shown('nokta-lyrics-fullscreen'), f?.opacity, f?.width, Main.layoutManager.monitors[0].width, one('nokta-lyrics-fullscreen-current')?.text, $FULL_ROMANIZED, Main.modalActorFocusStack.length])"
# The view's own grab, so the check holds whatever the notch under it does.
js "$FIND global._noktaFullscreen = one('nokta-lyrics-fullscreen'); true" > /dev/null
wait_for "full-screen lyrics show the cover, title, artist and the controls" \
    "$FIND shown('nokta-lyrics-fullscreen-cover') && one('nokta-lyrics-fullscreen-title').text === 'Midnight Static' && one('nokta-lyrics-fullscreen-artist').text === 'The Paper Lanterns' && shown('nokta-lyrics-fullscreen-play') && shown('nokta-lyrics-fullscreen-close') && find(Main.layoutManager.uiGroup, 'nokta-lyrics-fullscreen-line').filter((a) => a.mapped).length === 5" 5 \
    "$FIND JSON.stringify([shown('nokta-lyrics-fullscreen-cover'), one('nokta-lyrics-fullscreen-title')?.text, one('nokta-lyrics-fullscreen-artist')?.text, shown('nokta-lyrics-fullscreen-play'), shown('nokta-lyrics-fullscreen-close'), find(Main.layoutManager.uiGroup, 'nokta-lyrics-fullscreen-line').filter((a) => a.mapped).length])"
FULL_STATUS="Main.extensionManager.lookup('nokta@nokta.io').stateObj?.session?.media?.snapshot().playbackStatus"
"$HERE/keys.sh" space
wait_for "Space pauses the song from full-screen lyrics" "$FIND $FULL_STATUS === 'Paused' && any('nokta-lyrics-fullscreen')" 5 "$FULL_STATUS"
js "$FIND one('nokta-lyrics-fullscreen-play').emit('clicked', 1); true" > /dev/null
wait_for "the play button plays it again and leaves the view open" "$FIND $FULL_STATUS === 'Playing' && any('nokta-lyrics-fullscreen')" 5 "$FULL_STATUS"
"$HERE/shot.sh" smoke-lyrics-fullscreen > /dev/null
"$HERE/keys.sh" Escape
wait_for "Escape closes the full-screen lyrics and lets the keyboard go" \
    "$FIND !any('nokta-lyrics-fullscreen') && !Main.modalActorFocusStack.some((m) => m.actor === global._noktaFullscreen)" 5 \
    "$FIND JSON.stringify([any('nokta-lyrics-fullscreen'), Main.modalActorFocusStack.length])"
js "delete global._noktaFullscreen; true" > /dev/null
wait_for "the player opens again under the pointer" \
    "$FIND shown('nokta-expanded') && !shown('nokta-lyrics-sheet') && shown('nokta-lyric') && Math.round(one('nokta-body').height) === 194" 5 \
    "$FIND JSON.stringify([shown('nokta-expanded'), shown('nokta-lyrics-sheet'), shown('nokta-lyric'), Math.round(one('nokta-body')?.height ?? -1)])"
# The grid button at the player's top right opens home, whose music button
# goes back to the player.
js "$FIND one('nokta-grid-button').emit('clicked', 1); true" > /dev/null
wait_for "the grid button opens home over the player" \
    "$FIND shown('nokta-panel') && shown('nokta-panel-player') && !shown('nokta-expanded')" 5
"$HERE/shot.sh" smoke-home > /dev/null
js "$FIND one('nokta-panel-player').emit('clicked', 1); true" > /dev/null
wait_for "the music button goes back to the player" "$FIND shown('nokta-expanded') && !shown('nokta-panel')" 5
# With the cover behind the player, the open player shows the song's cover,
# blurred and darkened under white text; home over the player shows the
# theme again, and the player brings the cover back.
BACKDROP_PALETTE="Main.extensionManager.lookup('nokta@nokta.io').stateObj?.session?.notches?.[0]?.notch?.palette"
BACKDROP_SHOWN="$BACKDROP_PALETTE?.picture?.darken === 0.45 && ($BACKDROP_PALETTE?.picture?.path ?? '').endsWith('.backdrop.png') && $BACKDROP_PALETTE?.foreground === '#ffffff' && shown('nokta-picture') && one('nokta-picture').opacity === 255"
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
    --method io.nokta.Settings1.Set appearance cover_backdrop "<true>" > /dev/null
wait_for "the cover shows behind the open player" "$FIND $BACKDROP_SHOWN" 5 \
    "$FIND JSON.stringify([$BACKDROP_PALETTE?.picture, shown('nokta-picture'), one('nokta-picture')?.opacity])"
"$HERE/shot.sh" smoke-backdrop > /dev/null
js "$FIND one('nokta-grid-button').emit('clicked', 1); true" > /dev/null
wait_for "home over the player fades the cover out" \
    "$FIND shown('nokta-panel') && $BACKDROP_PALETTE?.picture === null && !shown('nokta-picture')" 5
js "$FIND one('nokta-panel-player').emit('clicked', 1); true" > /dev/null
wait_for "the player brings the cover back" "$FIND shown('nokta-expanded') && $BACKDROP_SHOWN" 5
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
    --method io.nokta.Settings1.Set appearance cover_backdrop "<false>" > /dev/null
wait_for "with the switch off, the player shows the theme" \
    "$FIND $BACKDROP_PALETTE?.picture === null && !shown('nokta-picture')" 5
# With the devshell's own PipeWire and its two silent outputs, the speaker
# button lists both; the menu holds the notch open after the pointer leaves,
# and picking the headphones switches the output and lets the notch close.
if [ -S "$STATE/runtime/pulse/native" ]; then
    MENU="$FIND const menu = () => find(Main.layoutManager.uiGroup, 'nokta-output-menu').find((a) => a.mapped);
const items = () => find(menu(), 'popup-menu-item');"
    wait_for "the open player shows the speakers as the sound output" \
        "$FIND shown('nokta-output-button') && one('nokta-output-button').child.gicon?.to_string().endsWith('/nokta-speaker-symbolic.svg')" 10 \
        "$FIND const c = Main.panel.statusArea.quickSettings._volumeOutput?._output?._control; JSON.stringify([shown('nokta-output-button'),
one('nokta-output-button')?.child.gicon?.to_string(), c?.get_state(), c?.get_default_sink()?.get_name(),
c?.get_sinks().map((s) => s.get_name())])"
    js "$FIND one('nokta-output-button').emit('clicked', 1); true" > /dev/null
    wait_for "the output button lists both outputs" \
        "$MENU menu() !== undefined && items().map((i) => i.label_actor?.text).join() === 'Headphones,Speakers'" 5 \
        "$MENU JSON.stringify(menu() && items().map((i) => i.label_actor?.text))"
    sleep 0.4
    "$HERE/shot.sh" smoke-outputs > /dev/null
    "$HERE/hover.sh" off > /dev/null
    holds "the output menu holds the notch open" "$FIND shown('nokta-expanded')" 1
    js "$MENU items().find((i) => i.label_actor?.text === 'Headphones').activate(imports.gi.Clutter.get_current_event()); true" > /dev/null
    wait_for "picking the headphones switches the sound output" \
        "$FIND one('nokta-output-button').child.gicon?.to_string().endsWith('/nokta-headphones-symbolic.svg')" 5
else
    echo "smoke: skip: the devshell has no PipeWire, so no output switching"
fi
"$HERE/hover.sh" off > /dev/null
wait_for "the player closes" "$FIND shown('nokta-collapsed') && width() === 260" 5

# A new song widens the closed notch with its title for 3 s; Previous brings
# the first song back, with its own peek.
media_player() {
    gdbus call --session --dest org.mpris.MediaPlayer2.noktafake \
        --object-path /org/mpris/MediaPlayer2 --method "org.mpris.MediaPlayer2.Player.$1" > /dev/null
}
media_player Next
wait_for "a new song shows its title in a 420 px closed notch" \
    "$FIND shown('nokta-peek') && one('nokta-peek-title').text.length > 0 && width() === 420" 5 \
    "$FIND JSON.stringify([shown('nokta-peek'), width()])"
"$HERE/shot.sh" smoke-peek > /dev/null
wait_for "the peek goes after 3 s" "$FIND shown('nokta-collapsed') && !shown('nokta-peek') && width() === 260" 6
media_player Previous
wait_for "the first song peeks again" "$FIND shown('nokta-peek')" 5
wait_for "and the notch closes back to the music" "$FIND shown('nokta-collapsed') && width() === 260" 6
# Paused, the bars rest and the closed cover dims.
"$HERE/player.sh" Paused
wait_for "paused, the closed cover dims" "$FIND shown('nokta-collapsed') && one('nokta-collapsed').get_first_child().opacity < 255" 5
"$HERE/shot.sh" smoke-paused > /dev/null
"$HERE/player.sh" Playing
wait_for "playing again, the cover is bright" "$FIND one('nokta-collapsed').get_first_child().opacity === 255" 5

# With [media] real_equalizer on, noktad records what plays (pw-record) and
# the bars follow it: a 100 Hz tone fills the first band and leaves the
# others low, which the pattern never holds. The bars move only with GNOME's
# animations on (off in CI). Nokta's own recording is no call, even when
# GNOME shows its microphone indicator for it.
if [ -S "$STATE/runtime/pipewire-0" ] && command -v pw-record > /dev/null 2>&1; then
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
        --method io.nokta.Settings1.Set media real_equalizer "<true>" > /dev/null
    "$HERE/tone.sh" on
    LEVELS="Main.extensionManager.lookup('nokta@nokta.io').stateObj.session.media.levels()"
    wait_for "noktad's levels follow a 100 Hz tone" \
        "const l = $LEVELS; l?.length === 4 && l[0] > 0.9 && l.slice(1).every((v) => v < 0.1)" 10 "JSON.stringify($LEVELS)"
    if [ "$(js "imports.gi.St.Settings.get().enable_animations")" = true ]; then
        BARS="find(Main.layoutManager.uiGroup, 'nokta-equalizer').find((a) => a.mapped)?.get_children().map((b) => b.scale_y)"
        TONE_BARS="$FIND const b = $BARS; b?.length === 4 && b[0] > 0.9 && b.slice(1).every((s) => s < 0.3)"
        wait_for "the bars follow the tone" "$TONE_BARS" 5 "$FIND JSON.stringify($BARS)"
        sleep 0.5
        [ "$(js "$TONE_BARS")" = true ] || fail "the bars left the tone: $(js "$FIND JSON.stringify($BARS)")"
        ok "the bars stay with the tone"
    else
        echo "smoke: skip: GNOME's animations are off, so the bars stay still"
    fi
    "$HERE/shot.sh" smoke-equalizer > /dev/null
    echo "smoke: note: GNOME's microphone indicator while Nokta records: $(js "Main.panel.statusArea.quickSettings._volumeInput?._indicator.visible")"
    [ "$(js "$FIND !find(Main.layoutManager.uiGroup, 'nokta-call').some((a) => a.mapped) && find(Main.layoutManager.uiGroup, 'nokta-privacy-dot').every((d) => !d.mapped)")" = true ] ||
        fail "Nokta's own recording shows as a call"
    ok "Nokta's own recording is no call"
    "$HERE/tone.sh" off
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
        --method io.nokta.Settings1.Set media real_equalizer "<false>" > /dev/null
    i=0
    until ! timeout 3 env XDG_RUNTIME_DIR="$STATE/runtime" pw-link -i | grep -q "^nokta-levels:"; do
        i=$((i + 1))
        [ "$i" -le 25 ] || fail "noktad still records with the setting off"
        sleep 0.2
    done
    ok "with the setting off noktad stops recording"
else
    echo "smoke: skip: the devshell has no PipeWire, so no bars that follow the music"
fi

# The open shortcut (a real key press through GNOME's keybinding) opens the
# focused monitor's notch and takes the keyboard with Main.pushModal: the
# first button has the focus, Tab and Shift+Tab move it, menus still open
# over it, the pointer leaving keeps it open, Enter presses the focused
# button, and Escape, the shortcut again or a click outside close it and let
# go of the keyboard.
NOTCH="Main.extensionManager.lookup('nokta@nokta.io').stateObj.session.notches[0]"
FOCUS="global.stage.key_focus"
HELD="Main.actionMode === imports.gi.Shell.ActionMode.POPUP && $NOTCH.holdsKeyboard"
FREE="Main.actionMode !== imports.gi.Shell.ActionMode.POPUP && !$NOTCH.holdsKeyboard"
FOCUSED_IN="(cls) => $FOCUS instanceof imports.gi.St.Button && $FOCUS.has_style_pseudo_class('focus') && one(cls).contains($FOCUS)"
KEYBOARD_STATE="$FIND JSON.stringify([shown('nokta-expanded'), shown('nokta-panel'), Main.actionMode, $NOTCH.holdsKeyboard, $FOCUS?.style_class ?? null])"
"$HERE/keys.sh" Super_L Alt_L n
wait_for "the open shortcut opens the player and holds the keyboard, its first button focused" \
    "$FIND $HELD && shown('nokta-expanded') && ($FOCUSED_IN)('nokta-expanded')" 5 "$KEYBOARD_STATE"
sleep 0.4
"$HERE/shot.sh" smoke-keyboard > /dev/null
js "global._noktaFocus = $FOCUS; true" > /dev/null
"$HERE/keys.sh" Tab
wait_for "Tab moves the focus to the next button" \
    "$FIND $FOCUS !== global._noktaFocus && ($FOCUSED_IN)('nokta-expanded')" 5 "$KEYBOARD_STATE"
"$HERE/keys.sh" Shift_L Tab
wait_for "Shift+Tab moves it back" "$FOCUS === global._noktaFocus" 5 "$KEYBOARD_STATE"
if [ -S "$STATE/runtime/pulse/native" ]; then
    OUTPUT_MENU="$FIND const menu = () => find(Main.layoutManager.uiGroup, 'nokta-output-menu').find((a) => a.mapped);"
    js "$FIND one('nokta-output-button').emit('clicked', 1); true" > /dev/null
    wait_for "held, the output button still opens its menu" "$OUTPUT_MENU menu() !== undefined" 5
    "$HERE/keys.sh" Escape
    wait_for "Escape closes the output menu first; the notch stays held" \
        "$OUTPUT_MENU menu() === undefined && shown('nokta-expanded') && $HELD" 5 "$KEYBOARD_STATE"
fi
NOTCH_MENU="one('nokta-menu')._delegate"
"$HERE/hover.sh" on > /dev/null
js "const Clutter = imports.gi.Clutter;
const now = () => global.get_current_time() * 1000;
global._noktaPointer.notify_button(now(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
global._noktaPointer.notify_button(now(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
true" > /dev/null
wait_for "held, a right click still opens the menu" "$FIND $NOTCH_MENU.isOpen" 5 "$KEYBOARD_STATE"
js "$FIND $NOTCH_MENU.close(); true" > /dev/null
wait_for "closing the menu gives the keyboard back to the notch" \
    "$FIND !$NOTCH_MENU.isOpen && $HELD && ($FOCUSED_IN)('nokta-expanded')" 5 "$KEYBOARD_STATE"
"$HERE/hover.sh" off > /dev/null
holds "held from the keyboard, the pointer leaving keeps it open" \
    "$FIND shown('nokta-expanded') && $HELD" 1 "$KEYBOARD_STATE"
js "$FIND one('nokta-grid-button').grab_key_focus(); true" > /dev/null
"$HERE/keys.sh" Return
wait_for "Enter presses the focused button: the grid button opens home, its first button focused" \
    "$FIND shown('nokta-panel') && !shown('nokta-expanded') && ($FOCUSED_IN)('nokta-panel')" 5 "$KEYBOARD_STATE"
"$HERE/keys.sh" Tab
sleep 0.4
"$HERE/shot.sh" smoke-keyboard-home > /dev/null
"$HERE/keys.sh" Escape
wait_for "Escape closes the notch and lets go of the keyboard" \
    "$FIND shown('nokta-collapsed') && $FREE && !($FOCUS && one('nokta-notch').contains($FOCUS))" 5 "$KEYBOARD_STATE"
"$HERE/keys.sh" Super_L Alt_L n
wait_for "the shortcut opens it again" "$FIND shown('nokta-expanded') && $HELD" 5 "$KEYBOARD_STATE"
"$HERE/keys.sh" Super_L Alt_L n
wait_for "the shortcut again closes it and lets go" "$FIND shown('nokta-collapsed') && $FREE" 5 "$KEYBOARD_STATE"
"$HERE/keys.sh" Super_L Alt_L n
wait_for "the shortcut opens it once more" "$FIND shown('nokta-expanded') && $HELD" 5 "$KEYBOARD_STATE"
"$HERE/click.sh" 200 600
wait_for "a click outside closes it and lets go" "$FIND shown('nokta-collapsed') && $FREE" 5 "$KEYBOARD_STATE"
# On GNOME 49 and later the virtual Super key can leave the overview open.
js "Main.overview.hide(); true" > /dev/null
wait_for "the overview is closed" "!Main.overview.visible" 10

# With open_on = "click", resting the pointer does not open the notch; a
# click does, and leaving closes it after the close delay.
set_open_on() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
        --method io.nokta.Settings1.Set behavior open_on "<'$1'>" > /dev/null
    wait_for "open_on is $1" \
        "Main.extensionManager.lookup('nokta@nokta.io').stateObj?.session?.settings?.behavior?.openOn === '$1'" 5
}
set_open_on click
"$HERE/hover.sh" on > /dev/null
holds "with open_on = click, hovering does not open the notch" \
    "$FIND shown('nokta-collapsed') && !shown('nokta-expanded')" 1
# Gestures on the closed notch: a wheel click up raises the volume 5 % and
# shows it in the notch; a middle click pauses the song and plays it again.
MIXER="Main.panel.statusArea.quickSettings._volumeOutput._output._control"
SINK="$MIXER.get_default_sink()"
MAX_NORM="$MIXER.get_vol_max_norm()"
if [ "$(js "!!$SINK" 2> /dev/null)" = true ]; then
    VOLUME_WAS=$(js "$SINK.volume")
    js "const s = $SINK; s.volume = Math.round($MAX_NORM / 2); s.push_volume(); true" > /dev/null
    js "const Clutter = imports.gi.Clutter;
global._noktaPointer.notify_discrete_scroll(global.get_current_time() * 1000, Clutter.ScrollDirection.UP, Clutter.ScrollSource.WHEEL);
true" > /dev/null
    wait_for "a scroll up on the notch raises the volume 5 % and shows it" \
        "$FIND shown('nokta-osd') && width() === 300 && Math.abs($SINK.volume - Math.round($MAX_NORM / 2) - Math.round($MAX_NORM * 0.05)) <= 1" 5 \
        "$FIND JSON.stringify([shown('nokta-osd'), width(), $SINK.volume, $MAX_NORM])"
    wait_for "the volume OSD goes away" "$FIND !shown('nokta-osd') && width() === 260" 5
    js "const s = $SINK; s.volume = $VOLUME_WAS; s.push_volume(); true" > /dev/null
else
    echo "smoke: skip: the devshell has no sound output, so no volume gesture"
fi
MEDIA_STATUS="Main.extensionManager.lookup('nokta@nokta.io').stateObj?.session?.media?.snapshot().playbackStatus"
middle_click() {
    js "const Clutter = imports.gi.Clutter;
const now = () => global.get_current_time() * 1000;
global._noktaPointer.notify_button(now(), Clutter.BUTTON_MIDDLE, Clutter.ButtonState.PRESSED);
global._noktaPointer.notify_button(now(), Clutter.BUTTON_MIDDLE, Clutter.ButtonState.RELEASED);
true" > /dev/null
}
middle_click
wait_for "a middle click pauses the song" "$MEDIA_STATUS === 'Paused'" 5 "$MEDIA_STATUS"
middle_click
wait_for "and another plays it again" "$MEDIA_STATUS === 'Playing'" 5 "$MEDIA_STATUS"
js "const Clutter = imports.gi.Clutter;
const now = () => global.get_current_time() * 1000;
global._noktaPointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
global._noktaPointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
true" > /dev/null
wait_for "a click on the closed notch opens it" "$FIND shown('nokta-expanded')" 5
"$HERE/hover.sh" off > /dev/null
wait_for "leaving closes it" "$FIND shown('nokta-collapsed') && width() === 260" 5
set_open_on hover

"$HERE/player.sh" Stopped > /dev/null
wait_for "the idle notch shows the clock in 180 px" \
    "$FIND shown('nokta-clock') && /^[0-9]{1,2}:[0-9]{2}/.test(one('nokta-clock').text) && width() === 180" 10
"$HERE/shot.sh" smoke-idle > /dev/null

# Hovering the idle notch opens home; its notifications tile opens GNOME's
# calendar from the top bar and gives the menu back to the clock.
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

# The quick toggles change the devshell's own GNOME settings; Caffeine holds
# an idle inhibitor in the fake session manager.
GSETTINGS='const g = (s) => new imports.gi.Gio.Settings({ schema_id: s });'
BANNERS="g('org.gnome.desktop.notifications').get_boolean('show-banners')"
SCHEME="g('org.gnome.desktop.interface').get_string('color-scheme')"
pill() { js "$FIND find(Main.layoutManager.uiGroup, 'nokta-pill')[$1].emit('clicked', 1); true" > /dev/null; }
inhibited() {
    gdbus call --session --dest org.gnome.SessionManager --object-path /org/gnome/SessionManager \
        --method org.gnome.SessionManager.IsInhibited 8
}
wait_inhibited() {
    i=0
    until inhibited | grep -q "$1"; do
        i=$((i + 1))
        [ "$i" -le 25 ] || fail "$2: $(inhibited)"
        sleep 0.2
    done
    ok "$2"
}
pill 0
wait_for "Do Not Disturb turns GNOME's banners off" "$GSETTINGS $FIND !$BANNERS && one('nokta-pill').checked" 5
pill 0
wait_for "and on again" "$GSETTINGS $FIND $BANNERS && !one('nokta-pill').checked" 5
pill 2
wait_for "Dark Style turns the dark style on" "$GSETTINGS $SCHEME === 'prefer-dark'" 5
pill 2
wait_for "and off again" "$GSETTINGS $SCHEME === 'default'" 5
pill 1
wait_inhibited true "Caffeine keeps the screen awake"
pill 1
wait_inhibited false "and lets it sleep again"

# home.toggles and home.tiles choose home's controls and their order. Night
# Light shows only where gnome-settings-daemon's schema is installed.
set_home() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
        --method io.nokta.Settings1.Set home "$1" "$2" > /dev/null
}
LABELS="const labels = (cls) => find(Main.layoutManager.uiGroup, cls).filter((a) => a.mapped).map((a) => a.text).join(',');"
NIGHT_SCHEMA='org.gnome.settings-daemon.plugins.color'
HAS_NIGHT=$(js "imports.gi.Gio.SettingsSchemaSource.get_default().lookup('$NIGHT_SCHEMA', true) !== null")
NIGHT="g('$NIGHT_SCHEMA').get_boolean('night-light-enabled')"
PILLS='Caffeine'
[ "$HAS_NIGHT" = true ] && PILLS='Night Light,Caffeine'
set_home toggles "<['night_light', 'caffeine']>"
set_home tiles "<['screenshot', 'settings']>"
wait_for "home shows the chosen toggles and tiles in their order" \
    "$LABELS $FIND labels('nokta-pill-label') === '$PILLS' && labels('nokta-tile-label') === 'Screenshot,Settings' && Math.round(one('nokta-body').height) === 183" 5 \
    "$LABELS $FIND JSON.stringify([labels('nokta-pill-label'), labels('nokta-tile-label'), Math.round(one('nokta-body').height)])"
"$HERE/shot.sh" smoke-home-layout > /dev/null
FIRST_PILL="find(Main.layoutManager.uiGroup, 'nokta-pill').find((a) => a.mapped)"
if [ "$HAS_NIGHT" = true ]; then
    js "$FIND $FIRST_PILL.emit('clicked', 1); true" > /dev/null
    wait_for "Night Light turns GNOME's night light on" "$GSETTINGS $FIND $NIGHT && $FIRST_PILL.checked" 5
    js "$FIND $FIRST_PILL.emit('clicked', 1); true" > /dev/null
    wait_for "and off again" "$GSETTINGS !$NIGHT" 5
else
    echo "smoke: skip: no Night Light without gnome-settings-daemon's schema"
fi
set_home toggles "<@as []>"
wait_for "home without toggles is shorter" \
    "$FIND !shown('nokta-panel-toggles') && shown('nokta-panel-tiles') && Math.round(one('nokta-body').height) === 139" 5
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-tile').find((a) => a.mapped).emit('clicked', 1); true" > /dev/null
wait_for "the screenshot tile closes the notch and opens GNOME's screenshot UI" \
    "$FIND Main.screenshotUI.visible && Math.round(one('nokta-body').height) === 32" 5
js "Main.screenshotUI.close(true); true" > /dev/null
set_home toggles "<['do_not_disturb', 'caffeine', 'dark_style']>"
set_home tiles "<['notifications', 'focus', 'timer', 'clipboard', 'settings']>"
"$HERE/hover.sh" off > /dev/null
"$HERE/hover.sh" on > /dev/null
wait_for "home is back to its default toggles and tiles" \
    "$LABELS $FIND labels('nokta-pill-label') === 'Do Not Disturb,Caffeine,Dark Style' && Math.round(one('nokta-body').height) === 183" 5

# A right click opens the notch's menu at the pointer; its Do Not Disturb
# switch is the same setting.
NOTCH_AT=$(js "$FIND const [x, y] = one('nokta-body').get_transformed_position(); Math.round(x + 60) + ', ' + Math.round(y + 12)")
NOTCH_AT=${NOTCH_AT#\"}
NOTCH_AT=${NOTCH_AT%\"}
js "const Clutter = imports.gi.Clutter;
global._noktaPointer ??= $SEAT_JS.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
const now = () => global.get_current_time() * 1000;
global._noktaPointer.notify_absolute_motion(now(), $NOTCH_AT);
global._noktaPointer.notify_button(now(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
global._noktaPointer.notify_button(now(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
true" > /dev/null
MENU="one('nokta-menu')._delegate"
wait_for "a right click opens the notch's menu" "$FIND shown('nokta-menu') && $MENU.isOpen" 5
sleep 0.4
"$HERE/shot.sh" smoke-menu > /dev/null
js "$FIND $MENU._getMenuItems()[1].toggle(); true" > /dev/null
wait_for "its Do Not Disturb switch turns banners off" "$GSETTINGS !$BANNERS" 5
js "$FIND $MENU._getMenuItems()[1].toggle(); $MENU.close(); true" > /dev/null
wait_for "the menu closes and banners are back on" "$GSETTINGS $FIND !$MENU.isOpen && $BANNERS" 5
"$HERE/hover.sh" on > /dev/null

DATE_MENU="Main.panel.statusArea.dateMenu.menu"
js "$FIND one('nokta-tile').emit('clicked', 1); true" > /dev/null
wait_for "the notifications tile opens GNOME's calendar" "$DATE_MENU.isOpen" 5
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
# With GNOME's mixer up (the devshell's PipeWire) Nokta also asks it who
# records, so that its own recording for the bars is no microphone dot.
# Nobody records here: the microphone indicator shown by hand gets no dot.
# The fake call below shows the microphone for real.
if [ -S "$STATE/runtime/pulse/native" ]; then DOTS=1; else DOTS=2; fi
wait_for "the camera shows a dot, the microphone one only for an app recording" \
    "$FIND find(Main.layoutManager.uiGroup, 'nokta-privacy-dot').filter((d) => d.mapped).length === $DOTS" 5
"$HERE/shot.sh" smoke-privacy > /dev/null
js "$QS._camera._indicator.visible = false; $QS._volumeInput._indicator.visible = false; true" > /dev/null
wait_for "the dots go away" \
    "$FIND find(Main.layoutManager.uiGroup, 'nokta-privacy-dot').every((d) => !d.mapped)" 5

# A fake call (mic.sh) records from the devshell's silent microphone, which
# turns GNOME's microphone indicator on: the closed notch shows the
# microphone and how long, home a 26 px row with the app. Its mute button
# mutes the microphone; its close button hides the call until the
# microphone goes off.
if [ -S "$STATE/runtime/pulse/native" ]; then
    CALL="$FIND const call = () => find(Main.layoutManager.uiGroup, 'nokta-call').find((a) => a.mapped);"
    SOURCE="$QS._volumeInput._control.get_default_source()"
    "$HERE/mic.sh" on
    wait_for "a call replaces the clock with the microphone and its time" \
        "$CALL call() !== undefined && !shown('nokta-clock') && /^0:[0-9]{2}$/.test(call().get_last_child().text)" 10 \
        "$CALL JSON.stringify([$QS._volumeInput._indicator.visible, call()?.get_last_child().text])"
    "$HERE/shot.sh" smoke-call > /dev/null
    "$HERE/hover.sh" on > /dev/null
    # 32 px closed, 128 px for the date, toggles and tiles, 36 px for the call.
    wait_for "home shows the call with its app" \
        "$FIND shown('nokta-panel-call') && find(one('nokta-panel-call'), 'nokta-panel-call-title')[0].text === 'Fake Call' && Math.round(one('nokta-body').height) === 219" 5 \
        "$FIND JSON.stringify([shown('nokta-panel-call'), find(one('nokta-panel-call'), 'nokta-panel-call-title')[0]?.text, one('nokta-body').height])"
    sleep 0.4
    "$HERE/shot.sh" smoke-call-panel > /dev/null
    # Without a session manager, some PipeWire versions cannot mute the
    # devshell's microphone at all, not even from Quick Settings.
    js "$SOURCE.change_is_muted(true); true" > /dev/null
    i=0
    until [ "$(js "$SOURCE.is_muted")" = true ] || [ "$i" -ge 10 ]; do
        i=$((i + 1))
        sleep 0.2
    done
    if [ "$i" -lt 10 ]; then
        js "$SOURCE.change_is_muted(false); true" > /dev/null
        wait_for "the microphone can be muted here" "!$SOURCE.is_muted" 5
        js "$FIND one('nokta-panel-call-mute').emit('clicked', 1); true" > /dev/null
        wait_for "the mute button mutes the microphone" \
            "$FIND $SOURCE.is_muted && one('nokta-panel-call-detail').text.startsWith('Muted · ')" 5 \
            "$FIND JSON.stringify([$SOURCE?.get_name(), $SOURCE?.is_muted, one('nokta-panel-call-detail').text])"
    else
        echo "smoke: skip: this PipeWire cannot mute the devshell's microphone"
    fi
    js "$FIND one('nokta-panel-call-hide').emit('clicked', 1); true" > /dev/null
    wait_for "the close button hides the call" \
        "$FIND !shown('nokta-panel-call') && Math.round(one('nokta-body').height) === 183" 5
    "$HERE/hover.sh" off > /dev/null
    wait_for "the clock comes back while the call is hidden" "$CALL shown('nokta-clock') && call() === undefined && width() === 180" 5
    "$HERE/mic.sh" off
    js "$SOURCE.change_is_muted(false); true" > /dev/null
    wait_for "GNOME's microphone indicator goes away with the call" "!$QS._volumeInput._indicator.visible" 5
else
    echo "smoke: skip: the devshell has no PipeWire, so no call"
fi

"$HERE/osd.sh" level audio-volume-medium-symbolic 0.5
wait_for "a volume OSD shows in a 300 px notch, without a glow" "$FIND shown('nokta-osd') && width() === 300 && one('nokta-glow').opacity === 0" 5
"$HERE/shot.sh" smoke-osd > /dev/null
wait_for "the OSD goes away" "$FIND !shown('nokta-osd') && width() === 180" 10
"$HERE/osd.sh" level audio-volume-muted-symbolic 0
wait_for "a muted speaker says Muted with no bar" \
    "$FIND shown('nokta-osd') && one('nokta-osd-text').text === 'Muted' && !shown('nokta-osd-track')" 5
wait_for "the muted OSD goes away" "$FIND !shown('nokta-osd') && width() === 180" 10
# Switching keyboard layouts shows the new one; this also checks that this
# GNOME version has the input source manager where Nokta looks.
"$HERE/osd.sh" layout
wait_for "a layout switch shows the layout's name" \
    "$FIND shown('nokta-osd') && one('nokta-osd-text').text !== '' && !/%$/.test(one('nokta-osd-text').text)" 10 \
    "$FIND one('nokta-osd-text')?.text"
"$HERE/shot.sh" smoke-layout > /dev/null
wait_for "the layout OSD goes away" "$FIND !shown('nokta-osd') && width() === 180" 10
# A device with a battery shows it before its percentage, filled to the level;
# one that reports none (a disconnect) shows no battery.
"$HERE/device.sh" connect 'Smoke Buds' 15
wait_for "a device alert shows its battery" \
    "$FIND shown('nokta-osd-battery') && one('nokta-osd-detail').text === '15%' && Math.round(one('nokta-osd-battery-fill').width) === 3" 10 \
    "$FIND JSON.stringify([shown('nokta-osd'), shown('nokta-osd-battery'), one('nokta-osd-detail')?.text, one('nokta-osd-battery-fill')?.width])"
"$HERE/shot.sh" smoke-device > /dev/null
wait_for "the device alert goes away" "$FIND !shown('nokta-osd') && width() === 180" 10
"$HERE/device.sh" disconnect
wait_for "a disconnect shows no battery" \
    "$FIND shown('nokta-osd') && one('nokta-osd-detail').text === 'Disconnected' && !shown('nokta-osd-battery')" 10
wait_for "the disconnect alert goes away" "$FIND !shown('nokta-osd') && width() === 180" 10

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

# Its actions show as up to three buttons in a row under the two lines, which
# makes the notch 32 px taller; the close button ends it in the notch, and
# GNOME's message list keeps it.
gdbus call --session --dest org.gnome.Shell \
    --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify \
    "Nokta smoke" "uint32 0" "mail-unread-symbolic" "Two buttons" "Reply or archive it" \
    "@as ['default', 'Open', 'reply', 'Reply', 'archive', 'Archive']" "@a{sv} {}" "int32 -1" > /dev/null
NOTE_BUTTONS="find(Main.layoutManager.uiGroup, 'nokta-notification-button-label').filter((l) => l.mapped).map((l) => l.text).join()"
wait_for "a notification with actions shows them as buttons in a 92 px notch" \
    "$FIND shown('nokta-notification') && $NOTE_BUTTONS === 'Reply,Archive' && shown('nokta-notification-close') && Math.round(one('nokta-body').height) === 92" 10 \
    "$FIND JSON.stringify([shown('nokta-notification'), $NOTE_BUTTONS, shown('nokta-notification-close'), Math.round(one('nokta-body').height)])"
sleep 0.4
"$HERE/shot.sh" smoke-notification-buttons > /dev/null
js "$FIND one('nokta-notification-close').emit('clicked', 1); true" > /dev/null
IN_LIST="Main.messageTray.getSources().some((s) => s.notifications.some((n) => n.title === 'Two buttons'))"
wait_for "the close button ends it in the notch and GNOME's list keeps it" \
    "$FIND !shown('nokta-notification') && width() === 180 && $IN_LIST" 5

# A new notification from the same app replaces the one that shows and
# counts on its icon; one from another app starts again. A real click on a
# button runs its action, and not the notification's own.
js "import('resource:///org/gnome/shell/ui/messageTray.js').then((MT) => {
global._noktaChat = new MT.Source({ title: 'Chat', iconName: 'user-available-symbolic' });
Main.messageTray.add(global._noktaChat);
global._noktaChat.addNotification(new MT.Notification({ source: global._noktaChat, title: 'First message', body: 'Hi', isTransient: true }));
}); true" > /dev/null
wait_for "a chat notification shows without a count" \
    "$FIND shown('nokta-notification') && one('nokta-notification-title').text === 'First message' && !shown('nokta-notification-badge')" 10
js "import('resource:///org/gnome/shell/ui/messageTray.js').then((MT) => {
global._noktaActed = '';
for (const title of ['Second message', 'Third message']) {
    const n = new MT.Notification({ source: global._noktaChat, title, body: 'Still there?', isTransient: true });
    n.addAction('Archive', () => { global._noktaActed = 'archive'; });
    n.connect('activated', () => { global._noktaActed = 'opened'; });
    global._noktaChat.addNotification(n);
}
}); true" > /dev/null
wait_for "two more from the same app stack into a count of 3" \
    "$FIND shown('nokta-notification') && one('nokta-notification-title').text === 'Third message' && shown('nokta-notification-badge') && one('nokta-notification-badge').text === '3' && $NOTE_BUTTONS === 'Archive'" 10 \
    "$FIND JSON.stringify([one('nokta-notification-title').text, shown('nokta-notification-badge'), one('nokta-notification-badge').text, $NOTE_BUTTONS])"
sleep 0.4
"$HERE/shot.sh" smoke-notification-stack > /dev/null
ARCHIVE_AT=$(js "$FIND const b = find(Main.layoutManager.uiGroup, 'nokta-notification-button').find((a) => a.mapped); const [x, y] = b.get_transformed_position(); Math.round(x + b.width / 2) + ' ' + Math.round(y + b.height / 2)")
ARCHIVE_AT=${ARCHIVE_AT#\"}
# shellcheck disable=SC2086 # two numbers
"$HERE/click.sh" ${ARCHIVE_AT%\"}
wait_for "a click on its button runs the action and ends it" \
    "$FIND global._noktaActed === 'archive' && !shown('nokta-notification')" 5 \
    "$FIND JSON.stringify([global._noktaActed, shown('nokta-notification')])"
"$HERE/hover.sh" off > /dev/null
js "import('resource:///org/gnome/shell/ui/messageTray.js').then((MT) => {
const mail = new MT.Source({ title: 'Mail', iconName: 'mail-unread-symbolic' });
Main.messageTray.add(mail);
for (const [source, title] of [[global._noktaChat, 'Fourth message'], [mail, 'New mail']])
    source.addNotification(new MT.Notification({ source, title, isTransient: true }));
}); true" > /dev/null
wait_for "one from another app starts the count again" \
    "$FIND shown('nokta-notification') && one('nokta-notification-title').text === 'New mail' && !shown('nokta-notification-badge') && Math.round(one('nokta-body').height) === 60" 10 \
    "$FIND JSON.stringify([one('nokta-notification-title').text, shown('nokta-notification-badge'), Math.round(one('nokta-body').height)])"
js "$FIND one('nokta-notification-close').emit('clicked', 1); true" > /dev/null
wait_for "the clock comes back after the notifications" "$FIND shown('nokta-clock') && width() === 180" 10

"$HERE/timer.sh" start focus
wait_for "a focus timer replaces the clock" \
    "$FIND shown('nokta-timer') && !shown('nokta-clock') && /^2[45]:[0-9]{2}$/.test(one('nokta-timer').text)" 10
"$HERE/shot.sh" smoke-timer > /dev/null
"$HERE/timer.sh" stop
wait_for "the clock comes back when the timer stops" "$FIND shown('nokta-clock') && !shown('nokta-timer')" 10
# A countdown takes the clock's place too, and alerts when it runs out.
"$HERE/timer.sh" countdown 3 "Smoke eggs"
wait_for "a countdown replaces the clock, with its progress line" \
    "$FIND shown('nokta-timer') && !shown('nokta-clock') && /^0:0[0-3]$/.test(one('nokta-timer').text) && shown('nokta-progress-line')" 5
"$HERE/shot.sh" smoke-countdown > /dev/null
wait_for "a finished countdown alerts with its label, and glows" \
    "$FIND shown('nokta-osd') && one('nokta-osd-text').text === 'Smoke eggs' && one('nokta-osd-detail').text === 'Timer done' && one('nokta-glow').opacity > 0" 10
sleep 0.4
"$HERE/shot.sh" smoke-countdown-done > /dev/null
wait_for "the clock comes back after the alert, without the glow" "$FIND shown('nokta-clock') && !shown('nokta-osd') && one('nokta-glow').opacity === 0" 15

# A live activity takes the clock's place and gets a row in the panel; its
# end shows like a device alert.
"$HERE/activity.sh" set smoke "Smoke build" "Compiling" 0.4
wait_for "a live activity replaces the clock with its percentage" \
    "$FIND shown('nokta-activity-badge') && !shown('nokta-clock') && one('nokta-activity-badge-label').text === '40%'" 10
"$HERE/shot.sh" smoke-activity > /dev/null
"$HERE/hover.sh" on > /dev/null
# 32 px closed, 128 px for the date, toggles and tiles, 46 px for one activity.
wait_for "the panel grows a row for the activity" \
    "$FIND shown('nokta-panel-activity') && one('nokta-panel-activity-title').text === 'Smoke build' && Math.round(one('nokta-body').height) === 229" 5
"$HERE/shot.sh" smoke-activity-panel > /dev/null
"$HERE/hover.sh" off > /dev/null
wait_for "the panel closes over the activity" "$FIND shown('nokta-activity-badge') && width() === 180" 5
"$HERE/activity.sh" end smoke failed "Disk full"
wait_for "the end of the activity shows as an urgent alert" \
    "$FIND shown('nokta-osd') && one('nokta-osd-text').text === 'Smoke build' && one('nokta-osd-detail').text === 'Disk full' && one('nokta-osd').has_style_class_name('nokta-osd-urgent')" 5
"$HERE/shot.sh" smoke-activity-ended > /dev/null
# A failed activity shakes the notch instead of the bounce, and the shake
# ends with the notch in its place.
wait_for "the failed activity's shake ends with the notch in its place" \
    "$FIND shown('nokta-osd') && one('nokta-notch').translation_x === 0" 5 \
    "$FIND one('nokta-notch').translation_x"
wait_for "the clock comes back when the activity ends" "$FIND shown('nokta-clock') && !shown('nokta-activity-badge')" 10

# An app's progress on the dock becomes an activity too. The shell's own
# connection sends it, so the sender stays on the bus like a real app.
mkdir -p "$STATE/data/applications"
printf '[Desktop Entry]\nType=Application\nName=Smoke Browser\nIcon=web-browser\n' \
    > "$STATE/data/applications/nokta-smoke-browser.desktop"
dock() {
    js "imports.gi.Gio.DBus.session.emit_signal(null, '/com/canonical/unity/launcherentry/1', 'com.canonical.Unity.LauncherEntry', 'Update', new imports.gi.GLib.Variant('(sa{sv})', ['application://nokta-smoke-browser.desktop', { progress: new imports.gi.GLib.Variant('d', $1), 'progress-visible': new imports.gi.GLib.Variant('b', $2) }])); true" > /dev/null
}
dock 0.3 true
wait_for "dock progress becomes an activity after a moment" \
    "$FIND shown('nokta-activity-badge') && one('nokta-activity-badge-label').text === '30%'" 10 \
    "$FIND JSON.stringify([shown('nokta-activity-badge'), one('nokta-activity-badge-label')?.text])"
dock 0.6 true
wait_for "its progress follows the dock" "$FIND one('nokta-activity-badge-label').text === '60%'" 5
dock 1.0 false
wait_for "the dock hiding it ends the activity as done" \
    "$FIND shown('nokta-osd') && one('nokta-osd-text').text === 'Smoke Browser' && one('nokta-osd-detail').text === 'Done' && !one('nokta-osd').has_style_class_name('nokta-osd-urgent')" 5 \
    "$FIND JSON.stringify([shown('nokta-osd'), one('nokta-osd-text')?.text, one('nokta-osd-detail')?.text])"
# The alert springs open first.
sleep 0.5
"$HERE/shot.sh" smoke-dock-done > /dev/null
wait_for "the clock comes back after the dock's activity" "$FIND shown('nokta-clock') && !shown('nokta-activity-badge')" 10

# A system update through PackageKit shows the same way. The fake starts
# PackageKit with it, after noktad, as a real update does.
"$HERE/device.sh" update 25
wait_for "a system update becomes an activity" \
    "$FIND shown('nokta-activity-badge') && one('nokta-activity-badge-label').text === '25%'" 10 \
    "$FIND JSON.stringify([shown('nokta-activity-badge'), one('nokta-activity-badge-label')?.text])"
"$HERE/device.sh" update 70
"$HERE/hover.sh" on > /dev/null
wait_for "the panel names the update and what it is doing" \
    "$FIND one('nokta-panel-activity-title').text === 'Installing updates' && one('nokta-panel-activity-detail').text === 'Downloading' && Math.round(one('nokta-body').height) === 229" 5 \
    "$FIND JSON.stringify([one('nokta-panel-activity-title')?.text, one('nokta-panel-activity-detail')?.text, Math.round(one('nokta-body').height)])"
"$HERE/shot.sh" smoke-update-panel > /dev/null
"$HERE/hover.sh" off > /dev/null
wait_for "the panel closes over the update" "$FIND shown('nokta-activity-badge') && one('nokta-activity-badge-label').text === '70%' && width() === 180" 5
"$HERE/device.sh" update-done
wait_for "the finished update ends as done" \
    "$FIND shown('nokta-osd') && one('nokta-osd-text').text === 'Installing updates' && one('nokta-osd-detail').text === 'Done'" 5 \
    "$FIND JSON.stringify([shown('nokta-osd'), one('nokta-osd-text')?.text, one('nokta-osd-detail')?.text])"
wait_for "the clock comes back after the update" "$FIND shown('nokta-clock') && !shown('nokta-activity-badge')" 10

# Fake events in the date menu's event source fill the panel's agenda, the
# first one's reminder (5 minutes before, by default) shows in the notch, and
# the closed notch then counts down to it. fake-eds.js gives that event a
# Meet link: its row and its reminder get a Join button. It also colors the
# calendars of the first two: each row has a strip in its calendar's color,
# the third one in the calendar tone.
EVENTS="Main.panel.statusArea.dateMenu._eventSource"
js "const now = Date.now(); $EVENTS.getEvents = () => [{ id: ['smoke-work', 'smoke-review', ''].join(String.fromCharCode(10)), date: new Date(now + 60 * 60000), end: new Date(now + 90 * 60000), summary: 'Smoke review' }, { id: ['smoke-src', 'smoke-meet', ''].join(String.fromCharCode(10)), date: new Date(now + 5 * 60000 + 8000), end: new Date(now + 35 * 60000), summary: 'Smoke standup' }, { id: 'smoke-retro', date: new Date(now + 120 * 60000), end: new Date(now + 150 * 60000), summary: 'Smoke retro' }]; $EVENTS.emit('changed'); true" > /dev/null
"$HERE/hover.sh" on > /dev/null
AGENDA="find(Main.layoutManager.uiGroup, 'nokta-panel-agenda-row').filter((a) => a.mapped)"
AGENDA_TITLES="$AGENDA.map((a) => find(a, 'nokta-panel-event-title')[0].text).join()"
JOINS="find(Main.layoutManager.uiGroup, 'nokta-panel-join').filter((a) => a.mapped)"
AGENDA_STRIPS="$AGENDA.map((a) => find(a, 'nokta-panel-event-strip')[0].style).join()"
AGENDA_TIMES="$AGENDA.map((a) => find(a, 'nokta-panel-event-time')[0].text)"
# 32 px closed, 128 px for the date, toggles and tiles, 28 px for the next
# event and 28 px more for each event after it.
wait_for "the panel's agenda lists the events, soonest first" \
    "$FIND $AGENDA_TITLES === 'Smoke standup,Smoke review,Smoke retro' && $AGENDA_TIMES.every((t) => /^[0-9]/.test(t)) && /in [0-9]+ min$/.test(one('nokta-panel-event-when').text) && Math.round(one('nokta-body').height) === 275" 5 \
    "$FIND JSON.stringify([$AGENDA_TITLES, $AGENDA_TIMES, one('nokta-panel-event-when')?.text, Math.round(one('nokta-body').height)])"
wait_for "each agenda row has a strip in its calendar's color" \
    "$FIND $AGENDA_STRIPS === 'background-color: #33d17a;,background-color: #c061cb;,background-color: #ff453a;'" 10 \
    "$FIND JSON.stringify($AGENDA_STRIPS)"
wait_for "the event with a meeting link has a Join button" \
    "$FIND $JOINS.length === 1 && ${AGENDA}[0].contains(${JOINS}[0])" 10 \
    "$FIND JSON.stringify([$JOINS.length])"
"$HERE/shot.sh" smoke-calendar-panel > /dev/null
"$HERE/hover.sh" off > /dev/null
wait_for "the event's reminder shows in the notch with a Join button" \
    "$FIND shown('nokta-notification') && one('nokta-notification-title').text === 'Smoke standup in 5 min' && $NOTE_BUTTONS === 'Join' && width() === 420" 15 \
    "$FIND JSON.stringify([shown('nokta-notification'), one('nokta-notification-title')?.text, $NOTE_BUTTONS, width()])"
"$HERE/shot.sh" smoke-calendar-reminder > /dev/null
COUNTDOWN="find(Main.layoutManager.uiGroup, 'nokta-countdown-label').find((a) => a.mapped)?.text"
wait_for "after the reminder, the closed notch counts down to the event" \
    "$FIND !shown('nokta-notification') && !shown('nokta-clock') && /^[45] min$/.test($COUNTDOWN ?? '')" 15 \
    "$FIND JSON.stringify([shown('nokta-notification'), shown('nokta-clock'), $COUNTDOWN])"
"$HERE/shot.sh" smoke-calendar-countdown > /dev/null
# The link would open a browser: the smoke test only keeps it.
js "globalThis.noktaSmokeLaunch = imports.gi.Gio.AppInfo.launch_default_for_uri; imports.gi.Gio.AppInfo.launch_default_for_uri = (uri) => { globalThis.noktaSmokeJoined = uri; return true; }; true" > /dev/null
"$HERE/hover.sh" on > /dev/null
wait_for "home opens over the countdown" "$FIND $JOINS.length === 1" 5
js "$FIND ${JOINS}[0].emit('clicked', 1); true" > /dev/null
wait_for "Join opens the meeting link, closes the notch and ends the countdown" \
    "$FIND globalThis.noktaSmokeJoined === 'https://meet.google.com/smo-kest-and' && shown('nokta-clock') && !any('nokta-countdown')" 5 \
    "$FIND JSON.stringify([globalThis.noktaSmokeJoined, shown('nokta-clock'), any('nokta-countdown')])"
"$HERE/hover.sh" off > /dev/null
js "imports.gi.Gio.AppInfo.launch_default_for_uri = globalThis.noktaSmokeLaunch; true" > /dev/null
js "delete $EVENTS.getEvents; $EVENTS.emit('changed'); true" > /dev/null
wait_for "the clock comes back without events" "$FIND shown('nokta-clock') && !any('nokta-countdown')" 10

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
# The drop left the pointer on the notch, which opens it.
"$HERE/hover.sh" off > /dev/null
wait_for "the closed notch shows one file on the shelf" \
    "$FIND any('nokta-shelf-badge') && one('nokta-shelf-badge-label').text === '1' && !shown('nokta-clock')" 5 \
    "$FIND JSON.stringify([any('nokta-shelf-badge'), one('nokta-shelf-badge-label')?.text, shown('nokta-clock'), shown('nokta-shelf-badge'), one('nokta-drop-content')?.mapped, one('nokta-body').width, one('nokta-body').height, one('nokta-clock')?.get_parent()?.get_parent()?.opacity])"
"$HERE/hover.sh" on > /dev/null
# 32 px closed, 151 px for the weekday and date, toggles and tiles, 54 px for the shelf row.
wait_for "the panel shows the shelf row" \
    "$FIND any('nokta-shelf-row') && find(Main.layoutManager.uiGroup, 'nokta-shelf-slot').filter((s) => s.mapped).length === 2 && Math.round(one('nokta-body').height) === 237" 5 \
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
    "$FIND shown('nokta-clock') && !any('nokta-shelf-badge') && $HELPER.get_frame_rect().x === -10000" 10 \
    "$FIND const r = $HELPER.get_frame_rect(); JSON.stringify([shown('nokta-clock'), any('nokta-shelf-badge'), any('nokta-shelf-row'), [r.x, r.y, r.width, r.height], Math.round(one('nokta-body').height), global.get_pointer().slice(0, 2)])"

# A screenshot shows as a preview with buttons instead of its banner. The
# fake one is made the way GNOME makes it; GNOME's screenshot UI names the
# file a moment after the notification, and only then can it go on the shelf.
# A real PNG, 96 x 64, so noktad can make its thumbnail.
echo "iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAABDklEQVR42u3azQ3CMAxAYbB6Yh7YgoEYjC3Yp2cO3IAiocQvsfp87U/qT06aVj6eb+vB2I6QQCCBBBJIIIEEEsgQSCCBBJotlhke4nE9bR263Nf9Av1w+TxnlNQyLc3XS3imKKHT5doaQO0ZwkZRS4c3inI6sFFU1CGNoqgOZhR1dZj7+6kxFIhZJlJHsYIEmhaI3M7ljWUFCSSQQAIJJJBAAnUP8gd73lhWkEAzAzGzLHUUK2g0UHYRZd8/Sk8BYApDUywjE2aB49agvvlgmyx0ke6VFbkFpd9i7bnBHTADXvMtGfL9QWMaqF55/vWnfV8dZm8526M4aXX4qSGQQAIJJJBAAhkCCSSQQHPGE41QTw032CeoAAAAAElFTkSuQmCC" | base64 -d > "$STATE/files/smoke-shot.png"
js "import('resource:///org/gnome/shell/ui/messageTray.js').then((MT) => {
const { GLib, St, Cogl } = imports.gi;
const pixels = new GLib.Bytes(new Uint8Array(160 * 90 * 4).fill(180));
const content = St.ImageContent.new_with_preferred_size(160, 90);
try {
    content.set_bytes(global.stage.context.get_backend().get_cogl_context(), pixels, Cogl.PixelFormat.RGBA_8888, 160, 90, 640);
} catch {
    content.set_bytes(pixels, Cogl.PixelFormat.RGBA_8888, 160, 90, 640);
}
const source = new MT.Source({ title: 'Screenshot', iconName: 'screenshot-recorded-symbolic' });
Main.messageTray.add(source);
const n = new MT.Notification({ source, title: 'Screenshot captured', body: 'You can paste the image from the clipboard.', gicon: content, isTransient: true });
n.addAction('Show in Files', () => {});
source.addNotification(n);
}); true" > /dev/null
SHOT_BUTTONS="find(Main.layoutManager.uiGroup, 'nokta-screenshot-button').map((b) => b.mapped).join()"
wait_for "a screenshot shows as a preview with Open and Show in Files" \
    "$FIND shown('nokta-screenshot') && $SHOT_BUTTONS === 'true,true,false'" 10 \
    "$FIND JSON.stringify([shown('nokta-screenshot'), $SHOT_BUTTONS])"
js "Main.screenshotUI.emit('screenshot-taken', imports.gi.Gio.File.new_for_path('$STATE/files/smoke-shot.png')); true" > /dev/null
wait_for "the saved file adds Keep on shelf" "$FIND $SHOT_BUTTONS === 'true,true,true'" 5
"$HERE/shot.sh" smoke-screenshot > /dev/null
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-screenshot-button')[2].emit('clicked', 1); true" > /dev/null
i=0
until shelf_items | grep -q "smoke-shot.png', 'image-x-generic'"; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "Keep on shelf did not put the screenshot on the shelf: $(shelf_items)"
    sleep 0.2
done
ok "Keep on shelf puts the screenshot on the shelf"
wait_for "the preview closes" "$FIND !shown('nokta-screenshot')" 5
# noktad makes a thumbnail for a picture, and the shelf row shows it.
i=0
until gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Shelf \
    --method org.freedesktop.DBus.Properties.Get io.nokta.Shelf1 Thumbnails | grep -q "smoke-shot.png'"; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "the screenshot on the shelf has no thumbnail"
    sleep 0.2
done
ok "the screenshot on the shelf gets a thumbnail"
"$HERE/hover.sh" on > /dev/null
wait_for "the shelf row shows the thumbnail instead of the icon" \
    "$FIND find(Main.layoutManager.uiGroup, 'nokta-shelf-thumbnail').some((t) => t.mapped)" 5 \
    "$FIND JSON.stringify([any('nokta-shelf-row'), find(Main.layoutManager.uiGroup, 'nokta-shelf-thumbnail').length, Math.round(one('nokta-body').height)])"
"$HERE/shot.sh" smoke-shelf-thumbnail > /dev/null
"$HERE/hover.sh" off > /dev/null
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Shelf --method io.nokta.Shelf1.Clear > /dev/null
wait_for "the clock comes back when the shelf is cleared" "$FIND shown('nokta-clock')" 10

# GNOME's screenshot UI says it records the screen: the closed notch shows a
# red dot and how long, home a 26 px row whose stop button stops it. There
# is no recorder here, so only GNOME's own state changes.
UI="Main.screenshotUI"
js "$UI._setScreencastInProgress(true); true" > /dev/null
wait_for "a screen recording replaces the clock with a red dot and its time, and no line" \
    "$FIND any('nokta-recording') && !shown('nokta-clock') && !shown('nokta-progress-line') && /^0:[0-9]{2}$/.test(find(Main.layoutManager.uiGroup, 'nokta-recording').find((a) => a.mapped).get_last_child().text)" 5
"$HERE/shot.sh" smoke-recording > /dev/null
"$HERE/hover.sh" on > /dev/null
# 32 px closed, 128 px for the date, toggles and tiles, 36 px for the recording.
wait_for "home shows the recording" \
    "$FIND shown('nokta-panel-recording') && Math.round(one('nokta-body').height) === 219" 5 \
    "$FIND JSON.stringify([shown('nokta-panel-recording'), Math.round(one('nokta-body').height)])"
js "$FIND one('nokta-panel-recording-stop').emit('clicked', 1); true" > /dev/null
wait_for "its stop button stops the recording" \
    "$FIND !$UI.screencast_in_progress && !shown('nokta-panel-recording') && Math.round(one('nokta-body').height) === 183" 5
"$HERE/hover.sh" off > /dev/null
wait_for "the clock comes back after the recording" "$FIND shown('nokta-clock') && !any('nokta-recording')" 5
# GNOME's own "Screencast recorded" banner, for a file it recorded, shows as
# a preview with a video icon; Keep on shelf parks the video.
printf 'not really a video' > "$STATE/files/smoke-recording.webm"
js "$UI._screencastPath = '$STATE/files/smoke-recording.webm'; $UI._showNotification('Screencast recorded'); true" > /dev/null
wait_for "a saved recording shows as a preview with a video icon and three buttons" \
    "$FIND shown('nokta-screenshot') && shown('nokta-screenshot-video') && $SHOT_BUTTONS === 'true,true,true'" 10 \
    "$FIND JSON.stringify([shown('nokta-screenshot'), shown('nokta-screenshot-video'), $SHOT_BUTTONS])"
sleep 0.4
"$HERE/shot.sh" smoke-recording-preview > /dev/null
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-screenshot-button')[2].emit('clicked', 1); true" > /dev/null
i=0
until shelf_items | grep -q "smoke-recording.webm'"; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "Keep on shelf did not put the recording on the shelf: $(shelf_items)"
    sleep 0.2
done
ok "Keep on shelf puts the recording on the shelf"
wait_for "the recording preview closes" "$FIND !shown('nokta-screenshot')" 5
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Shelf --method io.nokta.Shelf1.Clear > /dev/null
wait_for "the clock comes back when the shelf is cleared again" "$FIND shown('nokta-clock')" 10

# A copy goes to the clipboard history; its tile in home opens the list, a
# row copies the entry back, and the menu pauses the history.
clip_items() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Clipboard \
        --method org.freedesktop.DBus.Properties.Get io.nokta.Clipboard1 Items
}
clip_copy() {
    js "imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD, '$1'); true" > /dev/null
}
CLIP_TEXT="new Promise((r) => imports.gi.St.Clipboard.get_default().get_text(imports.gi.St.ClipboardType.CLIPBOARD, (_c, t) => r(t)))"
clip_copy "Smoke clipboard text"
i=0
until clip_items | grep -q "'text', 'Smoke clipboard text', '', false"; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "the copy is not in the clipboard history: $(clip_items)"
    sleep 0.2
done
ok "a copy goes to the clipboard history"
"$HERE/hover.sh" on > /dev/null
TILE="find(one('nokta-panel-tiles'), 'nokta-tile').find((t) => find(t, 'nokta-tile-label')[0]?.text === 'Clipboard')"
wait_for "home has a clipboard tile" "$FIND shown('nokta-panel') && $TILE?.mapped === true" 5
js "$FIND $TILE.emit('clicked', 1); true" > /dev/null
CLIP_ROWS="find(Main.layoutManager.uiGroup, 'nokta-clip-preview').filter((l) => l.mapped).map((l) => l.text).join(' | ')"
# The header and one 32 px row: 14 + 28 + 10 + 32 + 14.
wait_for "the clipboard tile opens the history" \
    "$FIND shown('nokta-subpage') && $CLIP_ROWS === 'Smoke clipboard text' && Math.round(one('nokta-body').height) === 98" 5 \
    "$FIND JSON.stringify([shown('nokta-subpage'), $CLIP_ROWS, Math.round(one('nokta-body').height)])"
clip_copy "Smoke second copy"
wait_for "a new copy goes on top of the list" "$FIND $CLIP_ROWS === 'Smoke second copy | Smoke clipboard text'" 5
# The notch grows for the new row first.
sleep 0.4
"$HERE/shot.sh" smoke-clipboard > /dev/null
# The search field takes the keyboard and filters as you type; Enter copies
# the first match and gives the keyboard back.
SEARCH="one('nokta-clip-search')"
js "$FIND one('nokta-clip-search-button').emit('clicked', 1); true" > /dev/null
# The header, the 30 px field and two rows: 14 + 28 + 10 + 34 + 68 + 14.
wait_for "the search button opens a field that has the keyboard" \
    "$FIND $SEARCH.mapped && global.stage.key_focus === $SEARCH.clutter_text && Math.round(one('nokta-body').height) === 168" 5 \
    "$FIND JSON.stringify([$SEARCH.mapped, global.stage.key_focus?.toString(), Math.round(one('nokta-body').height)])"
js "$FIND $SEARCH.text = 'SECOND'; true" > /dev/null
wait_for "typing filters the list" \
    "$FIND $CLIP_ROWS === 'Smoke second copy' && Math.round(one('nokta-body').height) === 132" 5 \
    "$FIND JSON.stringify([$CLIP_ROWS, Math.round(one('nokta-body').height)])"
sleep 0.4
"$HERE/shot.sh" smoke-clipboard-search > /dev/null
js "$FIND $SEARCH.clutter_text.emit('activate'); true" > /dev/null
wait_for "Enter copies the first match and closes the field" \
    "$FIND !$SEARCH.mapped && global.stage.key_focus !== $SEARCH.clutter_text && $CLIP_ROWS === 'Smoke second copy | Smoke clipboard text'" 5
wait_for "and that copy is on the clipboard" "$CLIP_TEXT.then((t) => t === 'Smoke second copy')" 5
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-clip-entry').filter((e) => e.mapped)[1].emit('clicked', 1); true" > /dev/null
wait_for "a row copies its entry back" "$CLIP_TEXT.then((t) => t === 'Smoke clipboard text')" 5
wait_for "and goes back on top" "$FIND $CLIP_ROWS === 'Smoke clipboard text | Smoke second copy'" 5
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-clip-pin').filter((e) => e.mapped)[0].emit('clicked', 1); true" > /dev/null
i=0
until clip_items | grep -q "'Smoke clipboard text', '', true"; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "the pin button did not pin the entry: $(clip_items)"
    sleep 0.2
done
ok "the pin button pins the entry"
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Clipboard --method io.nokta.Clipboard1.Clear > /dev/null
wait_for "clearing keeps the pinned entry" "$FIND $CLIP_ROWS === 'Smoke clipboard text'" 5
js "$FIND one('nokta-subpage-back').emit('clicked', 1); true" > /dev/null
wait_for "the back arrow goes home" "$FIND shown('nokta-panel') && !shown('nokta-subpage')" 5
# The timer tile opens its presets; one starts a countdown and goes back
# home, which gets a 26 px row for it. The body is larger while the notch
# moves and clipped to the shape, so read home's height once it rests.
wait_for "home comes to rest" "$FIND !one('nokta-body').has_clip" 5
HOME_HEIGHT=$(js "$FIND Math.round(one('nokta-body').height)")
TIMER_TILE="find(one('nokta-panel-tiles'), 'nokta-tile').find((t) => find(t, 'nokta-tile-label')[0]?.text === 'Timer')"
js "$FIND $TIMER_TILE.emit('clicked', 1); true" > /dev/null
# The header and two 32 px rows of presets: 14 + 28 + 10 + 70 + 14.
wait_for "the timer tile opens its presets" \
    "$FIND any('nokta-timer-preset') && Math.round(one('nokta-body').height) === 136" 5 \
    "$FIND JSON.stringify([any('nokta-timer-preset'), Math.round(one('nokta-body').height)])"
sleep 0.4
"$HERE/shot.sh" smoke-timer-page > /dev/null
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-timer-preset').find((b) => b.mapped && b.get_child().text === '5 min').emit('clicked', 1); true" > /dev/null
wait_for "a preset starts a countdown and goes home with its row" \
    "$FIND shown('nokta-panel') && any('nokta-panel-clock') && one('nokta-panel-clock-title').text === 'Timer' && Math.round(one('nokta-body').height) === $HOME_HEIGHT + 36" 5 \
    "$FIND JSON.stringify([shown('nokta-panel'), any('nokta-panel-clock'), Math.round(one('nokta-body').height)])"
sleep 0.4
"$HERE/shot.sh" smoke-timer-row > /dev/null
js "$FIND find(Main.layoutManager.uiGroup, 'nokta-panel-clock-remove').find((b) => b.mapped).emit('clicked', 1); true" > /dev/null
wait_for "its remove button takes the row away" \
    "$FIND !any('nokta-panel-clock') && Math.round(one('nokta-body').height) === $HOME_HEIGHT" 5
# The settings tile opens Nokta's own page: six theme swatches, three
# switches, motion and a row for the settings window. A swatch and a switch
# change the setting through the daemon at once.
APPEARANCE="Main.extensionManager.lookup('nokta@nokta.io').stateObj?.session?.settings?.appearance"
SETTINGS_TILE="find(one('nokta-panel-tiles'), 'nokta-tile').find((t) => find(t, 'nokta-tile-label')[0]?.text === 'Settings')"
THEME=$(js "$APPEARANCE.theme")
js "$FIND $SETTINGS_TILE.emit('clicked', 1); true" > /dev/null
# The header and the 240 px page: 14 + 28 + 10 + 240 + 14.
wait_for "the settings tile opens the settings page" \
    "$FIND any('nokta-subpage') && find(Main.layoutManager.uiGroup, 'nokta-settings-theme').filter((b) => b.mapped).length === 7 && Math.round(one('nokta-body').height) === 306" 5 \
    "$FIND JSON.stringify([any('nokta-subpage'), find(Main.layoutManager.uiGroup, 'nokta-settings-theme').filter((b) => b.mapped).length, Math.round(one('nokta-body').height)])"
sleep 0.4
"$HERE/shot.sh" smoke-settings-page > /dev/null
js "$FIND one('nokta-settings-theme-graphite').emit('clicked', 1); true" > /dev/null
wait_for "a swatch sets the theme" "$APPEARANCE.theme === 'graphite'" 5
GLOW="$APPEARANCE.alertGlow"
GLOW_WAS=$(js "$GLOW")
js "$FIND find(one('nokta-settings'), 'nokta-settings-row')[2].emit('clicked', 1); true" > /dev/null
wait_for "a switch flips its setting" "$GLOW === !$GLOW_WAS" 5
js "$FIND find(one('nokta-settings'), 'nokta-settings-row')[2].emit('clicked', 1); one('nokta-settings-theme-$(printf %s "$THEME" | tr -d '"')').emit('clicked', 1); true" > /dev/null
wait_for "and both go back" "$APPEARANCE.theme === $THEME && $GLOW === $GLOW_WAS" 5
# Custom's gradient runs the way it is set: red to blue, left to right.
set_appearance() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
        --method io.nokta.Settings1.Set appearance "$1" "$2" > /dev/null
}
PALETTE="Main.extensionManager.lookup('nokta@nokta.io').stateObj?.session?.notches?.[0]?.notch?.palette"
set_appearance background "<'#ff0000'>"
set_appearance background_end "<'#0000ff'>"
set_appearance gradient "<'across'>"
set_appearance theme "<'custom'>"
wait_for "custom runs its gradient across" \
    "JSON.stringify([$PALETTE?.theme, $PALETTE?.gradient, $PALETTE?.direction]) === JSON.stringify(['custom', '#0000ff', [1, 0]])" 5 \
    "JSON.stringify([$PALETTE?.theme, $PALETTE?.gradient, $PALETTE?.direction])"
sleep 0.4
"$HERE/shot.sh" smoke-gradient > /dev/null
set_appearance gradient "<'none'>"
set_appearance background "<'#000000'>"
set_appearance theme "<'$(printf %s "$THEME" | tr -d '"')'>"
wait_for "and back to flat" "$APPEARANCE.gradient === 'none' && $APPEARANCE.theme === $THEME" 5
# Following the system style, a light style shows light_theme and a dark one
# the theme; a swatch picked under the light style sets light_theme.
SCHEME="new imports.gi.Gio.Settings({ schema_id: 'org.gnome.desktop.interface' })"
SCHEME_WAS=$(js "$SCHEME.get_string('color-scheme')")
set_appearance follow_system_style "<true>"
js "$SCHEME.set_string('color-scheme', 'default'); true" > /dev/null
wait_for "a light system style shows the light theme" "$PALETTE?.theme === 'paper'" 5 "$PALETTE?.theme"
js "$FIND one('nokta-settings-theme-glass').emit('clicked', 1); true" > /dev/null
wait_for "a swatch under the light style sets the light theme" \
    "$APPEARANCE.lightTheme === 'glass' && $APPEARANCE.theme === $THEME && $PALETTE?.theme === 'glass'" 5
js "$SCHEME.set_string('color-scheme', 'prefer-dark'); true" > /dev/null
wait_for "a dark system style shows the theme" "$PALETTE?.theme === $THEME" 5 "$PALETTE?.theme"
set_appearance light_theme "<'paper'>"
set_appearance follow_system_style "<false>"
js "$SCHEME.set_string('color-scheme', $SCHEME_WAS); true" > /dev/null
wait_for "and back to one theme" "$APPEARANCE.followSystemStyle === false && $APPEARANCE.lightTheme === 'paper'" 5
# All settings closes the notch and asks the extension for its window; the
# window itself opens through prefs.sh below.
js "const e = Main.extensionManager.lookup('nokta@nokta.io').stateObj; global._noktaPrefs = 0; e.openPreferences = () => global._noktaPrefs++; true" > /dev/null
js "$FIND one('nokta-settings-all').emit('clicked', 1); true" > /dev/null
wait_for "All settings opens the settings window" "$FIND global._noktaPrefs === 1 && !any('nokta-subpage')" 5
js "delete Main.extensionManager.lookup('nokta@nokta.io').stateObj.openPreferences; true" > /dev/null
"$HERE/hover.sh" off > /dev/null
wait_for "the panel closes" "$FIND shown('nokta-clock') && width() === 180" 5
# The picture theme shows an image inside the silhouette, an orange band over
# blue; the closed notch is a window onto its top middle, and the notch keeps
# its sizes.
PICTURE_FILE=/tmp/nokta-smoke-picture.png
js "const P = imports.gi.GdkPixbuf; const p = P.Pixbuf.new(P.Colorspace.RGB, false, 8, 640, 360); p.fill(0x2060c0ff); p.new_subpixbuf(0, 0, 640, 120).fill(0xe08030ff); p.savev('$PICTURE_FILE', 'png', [], []); true" > /dev/null
WIDTH_BEFORE=$(js "$FIND width()")
set_appearance picture "<'$PICTURE_FILE'>"
set_appearance theme "<'picture'>"
wait_for "the picture theme shows the prepared picture" \
    "$FIND $PALETTE?.theme === 'picture' && ($PALETTE?.picture?.path ?? '').endsWith('.png') && shown('nokta-picture') && width() === $WIDTH_BEFORE" 10 \
    "$FIND JSON.stringify([$PALETTE?.theme, $PALETTE?.picture, shown('nokta-picture'), width()])"
"$HERE/shot.sh" smoke-picture > /dev/null
"$HERE/hover.sh" on > /dev/null
wait_for "the open notch shows more of the same picture" \
    "$FIND width() === 420 && shown('nokta-picture') && Math.round(one('nokta-picture').width) === 436" 5 \
    "$FIND JSON.stringify([width(), one('nokta-picture')?.width])"
"$HERE/shot.sh" smoke-picture-open > /dev/null
"$HERE/hover.sh" off > /dev/null
wait_for "the notch closes over the picture" "$FIND width() === $WIDTH_BEFORE" 5
set_appearance picture "<''>"
wait_for "without a picture, the picture theme draws like midnight" \
    "$FIND $PALETTE?.theme === 'picture' && $PALETTE?.picture === null && !shown('nokta-picture') && $PALETTE?.background === '#000000'" 5
set_appearance theme "<'$(printf %s "$THEME" | tr -d '"')'>"
wait_for "and back to the theme" "$APPEARANCE.theme === $THEME" 5
# The middle of the closed notch: NOTCH_AT was taken on the open panel.
js "$FIND const Clutter = imports.gi.Clutter;
const now = () => global.get_current_time() * 1000;
const [x, y] = one('nokta-body').get_transformed_position();
global._noktaPointer.notify_absolute_motion(now(), Math.round(x + width() / 2), Math.round(y + 12));
global._noktaPointer.notify_button(now(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
global._noktaPointer.notify_button(now(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
true" > /dev/null
PAUSE_ITEM="$MENU._getMenuItems().find((i) => i.label?.text === 'Pause clipboard')"
wait_for "the menu has Pause clipboard" "$FIND $MENU.isOpen && $PAUSE_ITEM?.visible === true" 5 \
    "$FIND JSON.stringify([any('nokta-menu'), global.get_pointer().slice(0, 2), width()])"
js "$FIND $PAUSE_ITEM.toggle(); $MENU.close(); true" > /dev/null
i=0
until gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Clipboard \
    --method org.freedesktop.DBus.Properties.Get io.nokta.Clipboard1 Paused | grep -q true; do
    i=$((i + 1))
    [ "$i" -le 25 ] || fail "Pause clipboard did not pause the history"
    sleep 0.2
done
ok "Pause clipboard pauses the history"
clip_copy "Smoke copy while paused"
sleep 0.5
clip_items | grep -q "while paused" && fail "a copy was kept while paused: $(clip_items)"
ok "copies are not kept while paused"
gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Clipboard --method io.nokta.Clipboard1.SetPaused false > /dev/null
"$HERE/hover.sh" off > /dev/null

BANNERS="new imports.gi.Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' }).get_boolean('show-banners')"
"$HERE/keys.sh" Super_L Alt_L f
wait_for "the shortcut starts focus and banners go quiet" "$FIND shown('nokta-timer') && !($BANNERS)" 10
"$HERE/keys.sh" Super_L Alt_L f
wait_for "the shortcut stops the timer and banners come back" "$FIND shown('nokta-clock') && $BANNERS" 10

# On GNOME 49 and later the virtual Super key of the shortcut steps can
# leave the overview open, which hides every window.
js "Main.overview.hide(); true" > /dev/null
wait_for "the overview is closed" "!Main.overview.visible" 10

# The notch follows fullscreen itself: a fullscreen window hides it, an
# important alert shows over the window with unredirection off (counted by
# wrapping GNOME's functions) and without opening on hover, and it hides
# again after. A volume OSD, or with fullscreen_alerts = "none" any alert,
# leaves it hidden.
set_fullscreen_alerts() {
    gdbus call --session --dest io.nokta.Nokta --object-path /io/nokta/Settings \
        --method io.nokta.Settings1.Set behavior fullscreen_alerts "<'$1'>" > /dev/null
    wait_for "fullscreen_alerts is $1" \
        "Main.extensionManager.lookup('nokta@nokta.io').stateObj?.session?.settings?.behavior?.fullscreenAlerts === '$1'" 5
}
NOTCH_SHOWN="one('nokta-notch').visible"
"$HERE/fullscreen.sh" on
wait_for "a fullscreen window hides the notch" "$FIND !one('nokta-notch').visible" 5
"$HERE/shot.sh" smoke-fullscreen > /dev/null
js "const c = global.compositor; const M = imports.gi.Meta;
// GNOME's ease() turns it off and on too, also for Nokta's actors: count only the notch's own calls.
const count = (step) => { if (new Error().stack.includes('nokta@nokta.io/shared/compat.js')) global._noktaUnredirect += step; };
global._noktaUnredirect = 0;
if (c.disable_unredirect) {
    const [off, on] = [c.disable_unredirect, c.enable_unredirect];
    global._noktaRestoreUnredirect = () => { delete c.disable_unredirect; delete c.enable_unredirect; };
    c.disable_unredirect = function () { count(1); return off.call(this); };
    c.enable_unredirect = function () { count(-1); return on.call(this); };
} else {
    const [off, on] = [M.disable_unredirect_for_display, M.enable_unredirect_for_display];
    global._noktaRestoreUnredirect = () => { M.disable_unredirect_for_display = off; M.enable_unredirect_for_display = on; };
    M.disable_unredirect_for_display = (d) => { count(1); return off(d); };
    M.enable_unredirect_for_display = (d) => { count(-1); return on(d); };
}
true" > /dev/null
"$HERE/timer.sh" countdown 1 "Smoke fullscreen"
wait_for "a finished countdown shows over the fullscreen window, unredirection off" \
    "$FIND $NOTCH_SHOWN && shown('nokta-osd') && one('nokta-osd-text').text === 'Smoke fullscreen' && global._noktaUnredirect === 1" 10 \
    "$FIND JSON.stringify([one('nokta-notch').visible, shown('nokta-osd'), one('nokta-osd-text')?.text, global._noktaUnredirect])"
"$HERE/hover.sh" on > /dev/null
holds "hovering does not open the notch over the fullscreen window" \
    "$FIND $NOTCH_SHOWN && shown('nokta-osd') && !shown('nokta-panel') && !shown('nokta-expanded')" 1
"$HERE/shot.sh" smoke-fullscreen-alert > /dev/null
"$HERE/hover.sh" off > /dev/null
wait_for "the notch hides again after the alert, unredirection back on" \
    "$FIND !one('nokta-notch').visible && global._noktaUnredirect === 0" 15 \
    "$FIND JSON.stringify([one('nokta-notch').visible, shown('nokta-osd'), global._noktaUnredirect])"
# Counts every time the notch shows from here on.
js "$FIND global._noktaShows = 0; global._noktaShowsId = one('nokta-notch').connect('notify::visible', (a) => { if (a.visible) global._noktaShows++; }); true" > /dev/null
"$HERE/osd.sh" level audio-volume-medium-symbolic 0.5
holds "a volume OSD leaves the notch hidden over the fullscreen window" "global._noktaShows === 0" 1
set_fullscreen_alerts none
"$HERE/timer.sh" countdown 1 "Smoke hidden"
holds "with fullscreen_alerts = none the notch stays hidden for an alert" "global._noktaShows === 0" 3
"$HERE/shot.sh" smoke-fullscreen-none > /dev/null
js "$FIND one('nokta-notch').disconnect(global._noktaShowsId); global._noktaRestoreUnredirect(); true" > /dev/null
set_fullscreen_alerts important
"$HERE/fullscreen.sh" off
wait_for "the notch comes back closed when the window leaves fullscreen" \
    "$FIND $NOTCH_SHOWN && !shown('nokta-osd') && (shown('nokta-clock') || shown('nokta-collapsed'))" 5
sleep 0.4
"$HERE/shot.sh" smoke-fullscreen-after > /dev/null

"$HERE/prefs.sh"
# A window actor exists before its first frame; the map animation fades it in.
# The windows the shell has, printed when the settings window does not open.
WINDOWS="JSON.stringify({overview: Main.overview.visible, group: global.window_group.visible, windows: global.get_window_actors().map((w) => [w.meta_window.get_title(), w.mapped, w.visible, w.opacity, w.meta_window.minimized, w.meta_window.get_workspace()?.index(), global.workspace_manager.get_active_workspace_index()].join(' '))})"
wait_for "the settings window opens" \
    "global.get_window_actors().some((w) => w.meta_window.get_title() === 'Nokta' && w.mapped && w.opacity === 255)" 30 \
    "$WINDOWS"
sleep 2
"$HERE/shot.sh" smoke-prefs > /dev/null
# GNOME's error page has the same title: a failed import shows only in the log.
if grep -q "Failed to open preferences" "$STATE/prefs.log"; then
    fail "the settings window shows GNOME's error page: $(grep -A3 "Failed to open preferences" "$STATE/prefs.log")"
fi
ok "the settings window shows Nokta's settings"

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
