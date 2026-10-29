// A fake Evolution Data Server calendar for the devshell: noktad reads the
// meeting link of an event from it. The event `smoke-meet` in any source has
// a Google Meet link; every other event has none.
// Usage: gjs -m fake-eds.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const FACTORY_XML = `<node><interface name="org.gnome.evolution.dataserver.CalendarFactory">
  <method name="OpenCalendar">
    <arg name="source_uid" type="s" direction="in"/>
    <arg name="object_path" type="s" direction="out"/>
    <arg name="bus_name" type="s" direction="out"/>
  </method>
</interface></node>`;

const CALENDAR_XML = `<node><interface name="org.gnome.evolution.dataserver.Calendar">
  <method name="Open"><arg name="properties" type="as" direction="out"/></method>
  <method name="GetObject">
    <arg name="uid" type="s" direction="in"/>
    <arg name="rid" type="s" direction="in"/>
    <arg name="object" type="s" direction="out"/>
  </method>
</interface></node>`;

const CALENDAR_PATH = '/org/gnome/evolution/dataserver/Calendar/Fake';

/** One VEVENT, folded and escaped like EDS sends it. */
const event = (uid, lines) =>
    ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `UID:${uid}`, ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

const factory = Gio.DBusExportedObject.wrapJSObject(FACTORY_XML, {
    OpenCalendar(source) {
        print(`open ${source}`);
        return [CALENDAR_PATH, Gio.DBus.session.get_unique_name()];
    },
});
const calendar = Gio.DBusExportedObject.wrapJSObject(CALENDAR_XML, {
    Open() {
        return [];
    },
    GetObject(uid, rid) {
        print(`get ${uid} ${rid}`);
        if (uid !== 'smoke-meet') return event(uid, ['SUMMARY:No link', 'LOCATION:Room 4']);
        return event(uid, [
            'SUMMARY:Smoke standup',
            'DESCRIPTION:Notes\\, then the call:\\nhttps://meet.google.com/smo-',
            ' kest-and',
        ]);
    },
});
factory.export(Gio.DBus.session, '/org/gnome/evolution/dataserver/CalendarFactory');
calendar.export(Gio.DBus.session, CALENDAR_PATH);
Gio.bus_own_name_on_connection(
    Gio.DBus.session,
    'org.gnome.evolution.dataserver.Calendar8',
    Gio.BusNameOwnerFlags.NONE,
    null,
    null,
);

new GLib.MainLoop(null, false).run();
