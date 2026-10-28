// The shelf's helper window, run by the shell with `gjs -m` as its own
// Wayland client. GNOME Shell cannot take a drop from an app or start a drag
// into one; this window can. It draws nothing: the notch draws the row and
// the drop area, and the shell places this window over them. It talks to
// noktad for the items and tells the shell what the pointer does on its
// standard output (see features/shelf/logic/protocol.ts).
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import { ShelfClient } from '../features/shelf/client.js';
import { urisFromList, urisToList, type ShelfItem } from '../features/shelf/logic/items.js';
import { itemAt, type Hit } from '../features/shelf/logic/layout.js';
import { helperLine, type HelperEvent } from '../features/shelf/logic/protocol.js';
import { watchDaemon } from '../shared/dbus.js';

const URI_LIST = 'text/uri-list';
const DRAG_ICON_SIZE = 32;

function tell(event: HelperEvent): void {
    print(helperLine(event));
}

Gtk.init();
const display = Gdk.Display.get_default();
if (!display) throw new Error('nokta-shelf: no display');
const css = new Gtk.CssProvider();
// Not fully transparent: a window that draws nothing never gets a buffer,
// so mutter never shows it. One step of alpha cannot be seen.
css.load_from_string('window, window.background { background: rgba(0, 0, 0, 0.004); box-shadow: none; }');
Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

const shelf = new ShelfClient();
let cancellable = new Gio.Cancellable();
watchDaemon(
    (connection) => {
        shelf.attach(connection, cancellable).catch((error: unknown) => console.warn('nokta-shelf: no shelf', error));
    },
    () => {
        cancellable.cancel();
        cancellable = new Gio.Cancellable();
        shelf.detach();
    },
);

const window = new Gtk.Window({ title: 'nokta-shelf', decorated: false, default_width: 1, default_height: 1 });
const area = new Gtk.Box({ hexpand: true, vexpand: true });
window.set_child(area);

function hitAt(x: number, y: number): Hit | null {
    return itemAt(x, y, shelf.items().length, area.get_width());
}

// The slot under the pointer, so the notch can show its close button.
let hovered = 'hover none';
function hover(hit: Hit | null): void {
    const line = helperLine({ kind: 'hover', hit });
    if (line === hovered) return;
    hovered = line;
    print(line);
}
// Where the pointer is while it is over the window, to show the right slot
// again when the items change under it.
let pointer: [number, number] | null = null;
const motion = new Gtk.EventControllerMotion();
motion.connect('enter', (_c, x: number, y: number) => {
    pointer = [x, y];
    tell({ kind: 'enter' });
    hover(hitAt(x, y));
});
motion.connect('motion', (_c, x: number, y: number) => {
    pointer = [x, y];
    hover(hitAt(x, y));
});
motion.connect('leave', () => {
    pointer = null;
    hover(null);
    tell({ kind: 'leave' });
});
shelf.onChanged(() => {
    if (pointer) hover(hitAt(...pointer));
});
area.add_controller(motion);

// A click opens the file, or takes it off the shelf on its close button.
const click = new Gtk.GestureClick();
click.connect('released', (_g, _n: number, x: number, y: number) => {
    const hit = hitAt(x, y);
    const items = shelf.items();
    if (!hit) return;
    if (hit.close) {
        if (hit.kind === 'stack') shelf.clear();
        else shelf.remove(items[hit.index].uri);
    } else if (hit.kind === 'item') {
        Gio.AppInfo.launch_default_for_uri_async(items[hit.index].uri, null, null, (_s, result) => {
            try {
                Gio.AppInfo.launch_default_for_uri_finish(result);
            } catch (error) {
                console.warn('nokta-shelf: cannot open the file', error);
            }
        });
    }
});
area.add_controller(click);

// Dropped files go on the shelf. A drag that started here is not taken back.
const drop = new Gtk.DropTargetAsync({
    actions: Gdk.DragAction.COPY,
    formats: Gdk.ContentFormats.new([URI_LIST]),
});
const ours = (gdkDrop: Gdk.Drop): boolean => gdkDrop.get_drag() !== null;
drop.connect('drag-enter', (_t, gdkDrop: Gdk.Drop) => (ours(gdkDrop) ? 0 : Gdk.DragAction.COPY));
drop.connect('drag-motion', (_t, gdkDrop: Gdk.Drop) => (ours(gdkDrop) ? 0 : Gdk.DragAction.COPY));
drop.connect('drop', (_t, gdkDrop: Gdk.Drop) => {
    if (ours(gdkDrop)) {
        gdkDrop.finish(0);
        return true;
    }
    readUris(gdkDrop)
        .then((uris) => {
            shelf.add(uris);
            gdkDrop.finish(Gdk.DragAction.COPY);
        })
        .catch((error: unknown) => {
            console.warn('nokta-shelf: cannot read the drop', error);
            gdkDrop.finish(0);
        });
    return true;
});
area.add_controller(drop);

function readUris(gdkDrop: Gdk.Drop): Promise<string[]> {
    return new Promise((resolve, reject) => {
        gdkDrop.read_async([URI_LIST], GLib.PRIORITY_DEFAULT, null, (_d, result) => {
            try {
                const [stream] = gdkDrop.read_finish(result);
                if (!stream) throw new Error('no data');
                const out = Gio.MemoryOutputStream.new_resizable();
                const flags = Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET;
                out.splice_async(stream, flags, GLib.PRIORITY_DEFAULT, null, (_o, spliced) => {
                    try {
                        out.splice_finish(spliced);
                        const bytes = out.steal_as_bytes().toArray();
                        resolve(urisFromList(new TextDecoder().decode(bytes)));
                    } catch (error) {
                        reject(error);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}

// Dragging a file out moves it off the shelf once an app has taken it.
// The stack drags every file at once.
let dragged: readonly ShelfItem[] = [];
const drag = new Gtk.DragSource({ actions: Gdk.DragAction.COPY });
drag.connect('prepare', (_s, x: number, y: number) => {
    const hit = hitAt(x, y);
    const items = shelf.items();
    if (!hit || hit.close) return null;
    dragged = hit.kind === 'stack' ? [...items] : [items[hit.index]];
    if (dragged.length === 0) return null;
    const icon = Gtk.IconTheme.get_for_display(display).lookup_icon(
        dragged[dragged.length - 1].icon,
        null,
        DRAG_ICON_SIZE,
        1,
        Gtk.TextDirection.NONE,
        0,
    );
    drag.set_icon(icon, DRAG_ICON_SIZE / 2, DRAG_ICON_SIZE / 2);
    const files = new GObject.Value();
    files.init(Gdk.FileList.$gtype);
    files.set_boxed(Gdk.FileList.new_from_array(dragged.map((item) => Gio.File.new_for_uri(item.uri))));
    const list = new TextEncoder().encode(urisToList(dragged.map((item) => item.uri)));
    return Gdk.ContentProvider.new_union([
        Gdk.ContentProvider.new_for_value(files),
        Gdk.ContentProvider.new_for_bytes(URI_LIST, new GLib.Bytes(list)),
    ]);
});
drag.connect('drag-begin', (_s, gdkDrag: Gdk.Drag) => {
    tell({ kind: 'drag', active: true });
    const taken = dragged;
    gdkDrag.connect('dnd-finished', () => {
        for (const item of taken) shelf.remove(item.uri);
    });
});
drag.connect('drag-end', () => tell({ kind: 'drag', active: false }));
area.add_controller(drag);

const loop = GLib.MainLoop.new(null, false);
window.connect('close-request', () => {
    loop.quit();
    return false;
});
window.present();
loop.run();
