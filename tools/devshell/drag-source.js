// A small GTK 4 window in the devshell that lets FILE... be dragged out of
// it, like a file manager would, so drops on the notch can be tried without
// one. Files dropped on it are printed as "drag-source: got URI". Started by
// drop.sh as a client of the devshell's Wayland display.
// Usage: gjs -m tools/devshell/drag-source.js [FILE...]
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

const files = ARGV.map((path) => Gio.File.new_for_path(path));

Gtk.init();
const window = new Gtk.Window({ title: 'nokta-drag-source', default_width: 320, default_height: 120 });
const label = new Gtk.Label({ label: `${files.length} file(s) to drag`, hexpand: true, vexpand: true });
window.set_child(label);

const drag = new Gtk.DragSource({ actions: Gdk.DragAction.COPY });
drag.connect('prepare', () => {
    if (files.length === 0) return null;
    const value = new GObject.Value();
    value.init(Gdk.FileList.$gtype);
    value.set_boxed(Gdk.FileList.new_from_array(files));
    const uris = files.map((file) => `${file.get_uri()}\r\n`).join('');
    return Gdk.ContentProvider.new_union([
        Gdk.ContentProvider.new_for_value(value),
        Gdk.ContentProvider.new_for_bytes('text/uri-list', new GLib.Bytes(new TextEncoder().encode(uris))),
    ]);
});
drag.connect('drag-end', () => print('drag-source: drag ended'));
label.add_controller(drag);

const drop = new Gtk.DropTarget({ actions: Gdk.DragAction.COPY });
drop.set_gtypes([Gdk.FileList.$gtype]);
drop.connect('drop', (_t, value) => {
    for (const file of value.get_files()) print(`drag-source: got ${file.get_uri()}`);
    return true;
});
label.add_controller(drop);

const loop = GLib.MainLoop.new(null, false);
window.connect('close-request', () => {
    loop.quit();
    return false;
});
window.present();
print('drag-source: ready');
loop.run();
