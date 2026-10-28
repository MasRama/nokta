// A fake GNOME session manager for the devshell, with only the inhibitors:
// the notch's Caffeine toggle holds one. IsInhibited tells the smoke test
// whether one is held.
// Usage: gjs -m fake-session.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const XML = `<node><interface name="org.gnome.SessionManager">
  <method name="Inhibit">
    <arg type="s" direction="in"/><arg type="u" direction="in"/>
    <arg type="s" direction="in"/><arg type="u" direction="in"/>
    <arg type="u" direction="out"/>
  </method>
  <method name="Uninhibit"><arg type="u" direction="in"/></method>
  <method name="IsInhibited"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
</interface></node>`;

/** Cookie to flags. */
const held = new Map();
let next = 1;

const manager = Gio.DBusExportedObject.wrapJSObject(XML, {
    Inhibit(appId, _toplevel, reason, flags) {
        const cookie = next++;
        held.set(cookie, flags);
        print(`inhibit ${cookie} ${appId} ${flags} ${reason}`);
        return cookie;
    },
    Uninhibit(cookie) {
        held.delete(cookie);
        print(`uninhibit ${cookie}`);
    },
    IsInhibited(flags) {
        return [...held.values()].some((f) => (f & flags) !== 0);
    },
});
manager.export(Gio.DBus.session, '/org/gnome/SessionManager');
Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.gnome.SessionManager', Gio.BusNameOwnerFlags.NONE, null, null);

new GLib.MainLoop(null, false).run();
