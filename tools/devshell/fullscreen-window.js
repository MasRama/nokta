// A GTK 4 window in the devshell that goes fullscreen at once, like a video
// player or a game, so the notch can be checked over a fullscreen app.
// Started by fullscreen.sh as a client of the devshell's Wayland display.
// Usage: gjs -m tools/devshell/fullscreen-window.js
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

Gtk.init();
const window = new Gtk.Window({ title: 'nokta-fullscreen' });
window.set_child(new Gtk.Label({ label: 'A fullscreen app', hexpand: true, vexpand: true }));

const loop = GLib.MainLoop.new(null, false);
window.connect('close-request', () => {
    loop.quit();
    return false;
});
window.fullscreen();
window.present();
print('fullscreen-window: ready');
loop.run();
