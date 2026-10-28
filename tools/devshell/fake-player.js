// A scripted MPRIS player for the devshell: one 200 s track with a generated
// cover. Its status follows <state>/player-status (see player.sh) and the
// PlayPause, Next, Previous and SetPosition methods. Shuffle and LoopStatus
// can be set over D-Bus, as the notch's buttons do.
// Usage: gjs -m fake-player.js STATE_DIR [N]
// N (2, 3, ...) starts another player with its own name, track and
// <state>/player-N-status file.
import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const state = System.programArgs[0] ?? GLib.get_tmp_dir();
const number = System.programArgs[1] ?? '';
const suffix = number ? `-${number}` : '';
const LENGTH_US = 200_000_000;
const TRACK_ID = '/io/nokta/devshell/track/1';

const ROOT_XML = `<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="Identity" type="s" access="read"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/>
    <property name="SupportedMimeTypes" type="as" access="read"/>
  </interface>
</node>`;

// wrapJSObject exports only the first interface of a node, so each
// interface gets its own description and exported object.
const PLAYER_XML = `<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek"><arg name="Offset" type="x" direction="in"/></method>
    <method name="SetPosition">
      <arg name="TrackId" type="o" direction="in"/>
      <arg name="Position" type="x" direction="in"/>
    </method>
    <signal name="Seeked"><arg name="Position" type="x"/></signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Rate" type="d" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
  </interface>
</node>`;

function drawCover(path) {
    const size = 256;
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
    const cr = new Cairo.Context(surface);
    const gradient = new Cairo.LinearGradient(0, 0, size, size);
    gradient.addColorStopRGB(0, 0.95, 0.45, 0.2);
    gradient.addColorStopRGB(1, 0.55, 0.1, 0.45);
    cr.setSource(gradient);
    cr.paint();
    cr.setSourceRGBA(1, 1, 1, 0.85);
    cr.arc(size / 2, size / 2, size / 4, 0, 2 * Math.PI);
    cr.fill();
    cr.setSourceRGBA(0.55, 0.1, 0.45, 1);
    cr.arc(size / 2, size / 2, size / 14, 0, 2 * Math.PI);
    cr.fill();
    surface.writeToPNG(path);
    cr.$dispose();
}

const coverPath = GLib.build_filenamev([state, `cover${suffix}.png`]);
drawCover(coverPath);

let status = 'Playing';
let shuffle = false;
let loopStatus = 'None';
let anchorUs = 0; // position at anchorAt
let anchorAt = GLib.get_monotonic_time();

const positionUs = () =>
    status === 'Playing'
        ? Math.min(LENGTH_US, anchorUs + (GLib.get_monotonic_time() - anchorAt))
        : anchorUs;

const root = {
    Identity: number ? `Nokta Fake Player ${number}` : 'Nokta Fake Player',
    CanQuit: false,
    CanRaise: false,
    HasTrackList: false,
    SupportedUriSchemes: [],
    SupportedMimeTypes: [],
    Raise() {},
    Quit() {},
};

const player = {
    get PlaybackStatus() {
        return status;
    },
    Rate: 1.0,
    get Metadata() {
        return {
            'mpris:trackid': new GLib.Variant('o', TRACK_ID),
            'xesam:title': new GLib.Variant('s', number ? `Second Wind ${number}` : 'Midnight Static'),
            'xesam:artist': new GLib.Variant('as', ['The Paper Lanterns']),
            'xesam:album': new GLib.Variant('s', 'Night Drive'),
            'mpris:length': new GLib.Variant('x', LENGTH_US),
            'mpris:artUrl': new GLib.Variant('s', GLib.filename_to_uri(coverPath, null)),
        };
    },
    get Position() {
        return positionUs();
    },
    CanGoNext: true,
    CanGoPrevious: true,
    CanPlay: true,
    CanPause: true,
    CanSeek: true,
    CanControl: true,
    get Shuffle() {
        return shuffle;
    },
    set Shuffle(value) {
        shuffle = value;
        exported.emit_property_changed('Shuffle', new GLib.Variant('b', shuffle));
        exported.flush();
    },
    get LoopStatus() {
        return loopStatus;
    },
    set LoopStatus(value) {
        if (!['None', 'Track', 'Playlist'].includes(value)) return;
        loopStatus = value;
        exported.emit_property_changed('LoopStatus', new GLib.Variant('s', loopStatus));
        exported.flush();
    },

    PlayPause() {
        setStatus(status === 'Playing' ? 'Paused' : 'Playing');
    },
    Play() {
        setStatus('Playing');
    },
    Pause() {
        setStatus('Paused');
    },
    Stop() {
        setStatus('Stopped');
    },
    Next() {
        seekTo(0);
    },
    Previous() {
        seekTo(0);
    },
    Seek(offset) {
        seekTo(positionUs() + offset);
    },
    SetPosition(trackId, position) {
        if (trackId === TRACK_ID) seekTo(position);
    },
};

const exportedRoot = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, root);
const exported = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, player);

function setStatus(next) {
    if (next === status) return;
    anchorUs = next === 'Stopped' ? 0 : positionUs();
    anchorAt = GLib.get_monotonic_time();
    status = next;
    exported.emit_property_changed('PlaybackStatus', new GLib.Variant('s', status));
    exported.flush();
    print(`status ${status}`);
}

function seekTo(us) {
    anchorUs = Math.max(0, Math.min(LENGTH_US, us));
    anchorAt = GLib.get_monotonic_time();
    exported.emit_signal('Seeked', new GLib.Variant('(x)', [anchorUs]));
}

// Start 50 s in, so a lyric line is current in screenshots.
seekTo(50_000_000);

const statusFile = Gio.File.new_for_path(GLib.build_filenamev([state, `player${suffix}-status`]));
function readStatus() {
    try {
        const [, bytes] = statusFile.load_contents(null);
        const next = new TextDecoder().decode(bytes).trim();
        if (['Playing', 'Paused', 'Stopped'].includes(next)) setStatus(next);
    } catch {
        // Missing, or being rewritten; the next change event reads it.
    }
}
const monitor = statusFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
monitor.connect('changed', readStatus);

exportedRoot.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
exported.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
// A status written before start applies before the name is owned.
readStatus();
Gio.bus_own_name_on_connection(Gio.DBus.session, `org.mpris.MediaPlayer2.noktafake${number}`,
    Gio.BusNameOwnerFlags.NONE, null, null);

new GLib.MainLoop(null, false).run();
