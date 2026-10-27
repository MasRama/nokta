// A fake UPower and BlueZ for the devshell. run.sh gives noktad the devshell
// bus as its system bus, so these stand in for the laptop battery and one
// pair of Bluetooth earbuds. device.sh drives them through
// io.nokta.devshell.FakeDevices at /io/nokta/devshell/FakeDevices.
// Usage: gjs -m fake-devices.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUDS = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';
const bus = Gio.DBus.session;

const UPOWER_XML = `<node><interface name="org.freedesktop.UPower">
  <property name="OnBattery" type="b" access="read"/>
</interface></node>`;
const DISPLAY_XML = `<node><interface name="org.freedesktop.UPower.Device">
  <property name="IsPresent" type="b" access="read"/>
  <property name="State" type="u" access="read"/>
  <property name="Percentage" type="d" access="read"/>
</interface></node>`;
const MANAGER_XML = `<node><interface name="org.freedesktop.DBus.ObjectManager">
  <method name="GetManagedObjects"><arg type="a{oa{sa{sv}}}" direction="out"/></method>
  <signal name="InterfacesAdded"><arg type="o"/><arg type="a{sa{sv}}"/></signal>
  <signal name="InterfacesRemoved"><arg type="o"/><arg type="as"/></signal>
</interface></node>`;
const DEVICE_XML = `<node><interface name="org.bluez.Device1">
  <property name="Alias" type="s" access="read"/>
  <property name="Icon" type="s" access="read"/>
  <property name="Class" type="u" access="read"/>
  <property name="Connected" type="b" access="read"/>
</interface></node>`;
const BATTERY_XML = `<node><interface name="org.bluez.Battery1">
  <property name="Percentage" type="y" access="read"/>
</interface></node>`;
const CONTROL_XML = `<node><interface name="io.nokta.devshell.FakeDevices">
  <method name="SetCharger"><arg type="b" direction="in"/></method>
  <method name="SetPercentage"><arg type="d" direction="in"/></method>
  <method name="SetFull"><arg type="b" direction="in"/></method>
  <method name="Connect"><arg type="s" direction="in"/><arg type="i" direction="in"/></method>
  <method name="Disconnect"/>
</interface></node>`;

const CHARGING = 1;
const DISCHARGING = 2;
const FULLY_CHARGED = 4;

const upower = { OnBattery: false };
const display = { IsPresent: true, State: CHARGING, Percentage: 76 };
const device = { Alias: 'Galaxy Buds2', Icon: 'audio-headset', Class: 0x240404, Connected: false };
const battery = { Percentage: 0 };

const upowerObject = Gio.DBusExportedObject.wrapJSObject(UPOWER_XML, upower);
const displayObject = Gio.DBusExportedObject.wrapJSObject(DISPLAY_XML, display);
const deviceObject = Gio.DBusExportedObject.wrapJSObject(DEVICE_XML, device);
const batteryObject = Gio.DBusExportedObject.wrapJSObject(BATTERY_XML, battery);
let batteryExported = false;

const deviceProps = () => ({
    Alias: new GLib.Variant('s', device.Alias),
    Icon: new GLib.Variant('s', device.Icon),
    Class: new GLib.Variant('u', device.Class),
    Connected: new GLib.Variant('b', device.Connected),
});

const manager = Gio.DBusExportedObject.wrapJSObject(MANAGER_XML, {
    GetManagedObjects() {
        const interfaces = { 'org.bluez.Device1': deviceProps() };
        if (batteryExported) {
            interfaces['org.bluez.Battery1'] = { Percentage: new GLib.Variant('y', battery.Percentage) };
        }
        return { [BUDS]: interfaces };
    },
});

function set(object, target, name, type, value) {
    target[name] = value;
    object.emit_property_changed(name, new GLib.Variant(type, value));
    object.flush();
}

function setState() {
    let state = upower.OnBattery ? DISCHARGING : CHARGING;
    if (!upower.OnBattery && display.Percentage >= 100) state = FULLY_CHARGED;
    set(displayObject, display, 'State', 'u', state);
}

const control = Gio.DBusExportedObject.wrapJSObject(CONTROL_XML, {
    SetCharger(plugged) {
        set(upowerObject, upower, 'OnBattery', 'b', !plugged);
        setState();
    },
    SetPercentage(value) {
        set(displayObject, display, 'Percentage', 'd', value);
        setState();
    },
    SetFull(full) {
        if (full) {
            set(upowerObject, upower, 'OnBattery', 'b', false);
            set(displayObject, display, 'Percentage', 'd', 100);
        }
        set(displayObject, display, 'State', 'u', full ? FULLY_CHARGED : CHARGING);
    },
    Connect(alias, level) {
        if (alias) set(deviceObject, device, 'Alias', 's', alias);
        set(deviceObject, device, 'Connected', 'b', true);
        if (level < 0) return;
        // Real earbuds report their battery a moment after connecting.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            battery.Percentage = level;
            if (!batteryExported) {
                batteryObject.export(bus, BUDS);
                batteryExported = true;
            }
            manager.emit_signal('InterfacesAdded', new GLib.Variant('(oa{sa{sv}})', [
                BUDS,
                { 'org.bluez.Battery1': { Percentage: new GLib.Variant('y', level) } },
            ]));
            return GLib.SOURCE_REMOVE;
        });
    },
    Disconnect() {
        set(deviceObject, device, 'Connected', 'b', false);
        if (batteryExported) {
            batteryObject.unexport();
            batteryExported = false;
            manager.emit_signal('InterfacesRemoved', new GLib.Variant('(oas)', [BUDS, ['org.bluez.Battery1']]));
        }
    },
});

upowerObject.export(bus, '/org/freedesktop/UPower');
displayObject.export(bus, '/org/freedesktop/UPower/devices/DisplayDevice');
manager.export(bus, '/');
deviceObject.export(bus, BUDS);
control.export(bus, '/io/nokta/devshell/FakeDevices');
for (const name of ['org.freedesktop.UPower', 'org.bluez', 'io.nokta.devshell.FakeDevices'])
    Gio.bus_own_name_on_connection(bus, name, Gio.BusNameOwnerFlags.NONE, null, null);

new GLib.MainLoop(null, false).run();
