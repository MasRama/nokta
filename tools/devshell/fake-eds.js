// A fake Evolution Data Server for the devshell: noktad reads the meeting
// link of an event and the color of its calendar from it. The event
// `smoke-meet` in any source has a Google Meet link; every other event has
// none. The sources in SOURCES have a color; every other source has none.
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

const MANAGER_XML = `<node><interface name="org.freedesktop.DBus.ObjectManager">
  <method name="GetManagedObjects">
    <arg name="objects" type="a{oa{sa{sv}}}" direction="out"/>
  </method>
</interface></node>`;

const SOURCES_PATH = '/org/gnome/evolution/dataserver/SourceManager';

/** Source uid to its key file, like EDS keeps it; colors as Evolution and GNOME Calendar write them. */
const SOURCES = {
    'smoke-src': '[Data Source]\nDisplayName=Smoke\n\n[Calendar]\nBackendName=local\nColor=#33D17A\n',
    'smoke-work': '[Data Source]\nDisplayName=Work\n\n[Calendar]\nBackendName=local\nColor=rgb(192,97,203)\n',
    'smoke-home': '[Data Source]\nDisplayName=Home\n\n[Calendar]\nBackendName=local\nColor=#62a0ea\n',
    'smoke-tasks': '[Data Source]\nDisplayName=Tasks\n\n[Task List]\nColor=#ff0000\n',
};

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
const manager = Gio.DBusExportedObject.wrapJSObject(MANAGER_XML, {
    GetManagedObjects() {
        print('sources');
        const objects = {};
        Object.entries(SOURCES).forEach(([uid, data], i) => {
            objects[`${SOURCES_PATH}/Source_${i}`] = {
                'org.gnome.evolution.dataserver.Source': {
                    UID: new GLib.Variant('s', uid),
                    Data: new GLib.Variant('s', data),
                },
            };
        });
        return new GLib.Variant('(a{oa{sa{sv}}})', [objects]);
    },
});
factory.export(Gio.DBus.session, '/org/gnome/evolution/dataserver/CalendarFactory');
calendar.export(Gio.DBus.session, CALENDAR_PATH);
manager.export(Gio.DBus.session, SOURCES_PATH);
for (const name of ['org.gnome.evolution.dataserver.Calendar8', 'org.gnome.evolution.dataserver.Sources5'])
    Gio.bus_own_name_on_connection(Gio.DBus.session, name, Gio.BusNameOwnerFlags.NONE, null, null);

new GLib.MainLoop(null, false).run();
