//! A fake UPower and BlueZ on the test bus, standing in for the system bus.

use zbus::Connection;

use super::bus::TestBus;

pub const UPOWER_PATH: &str = "/org/freedesktop/UPower";
pub const DISPLAY_DEVICE: &str = "/org/freedesktop/UPower/devices/DisplayDevice";

struct Upower {
    on_battery: bool,
}

#[zbus::interface(name = "org.freedesktop.UPower")]
impl Upower {
    #[zbus(property)]
    fn on_battery(&self) -> bool {
        self.on_battery
    }
}

struct DisplayDevice {
    percentage: f64,
    state: u32,
}

#[zbus::interface(name = "org.freedesktop.UPower.Device")]
impl DisplayDevice {
    #[zbus(property)]
    fn is_present(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn state(&self) -> u32 {
        self.state
    }

    #[zbus(property)]
    fn percentage(&self) -> f64 {
        self.percentage
    }
}

struct Device {
    alias: String,
    icon: String,
    connected: bool,
}

#[zbus::interface(name = "org.bluez.Device1")]
impl Device {
    #[zbus(property)]
    fn alias(&self) -> String {
        self.alias.clone()
    }

    #[zbus(property)]
    fn icon(&self) -> String {
        self.icon.clone()
    }

    #[zbus(property)]
    fn class(&self) -> u32 {
        0
    }

    #[zbus(property)]
    fn connected(&self) -> bool {
        self.connected
    }
}

struct Battery {
    percentage: u8,
}

#[zbus::interface(name = "org.bluez.Battery1")]
impl Battery {
    #[zbus(property)]
    fn percentage(&self) -> u8 {
        self.percentage
    }
}

/// Owns `org.freedesktop.UPower` and `org.bluez` on the test bus.
pub struct FakeDevices {
    conn: Connection,
}

impl FakeDevices {
    /// A laptop on AC at `percentage`, with BlueZ knowing no devices.
    pub async fn start(bus: &TestBus, percentage: f64) -> FakeDevices {
        let conn = bus.connect().await;
        let server = conn.object_server();
        server
            .at(UPOWER_PATH, Upower { on_battery: false })
            .await
            .unwrap();
        server
            .at(
                DISPLAY_DEVICE,
                DisplayDevice {
                    percentage,
                    state: 1,
                },
            )
            .await
            .unwrap();
        server.at("/", zbus::fdo::ObjectManager).await.unwrap();
        conn.request_name("org.freedesktop.UPower").await.unwrap();
        conn.request_name("org.bluez").await.unwrap();
        FakeDevices { conn }
    }

    pub async fn set_on_battery(&self, on_battery: bool) {
        let iface = self
            .conn
            .object_server()
            .interface::<_, Upower>(UPOWER_PATH)
            .await
            .unwrap();
        iface.get_mut().await.on_battery = on_battery;
        iface
            .get()
            .await
            .on_battery_changed(iface.signal_emitter())
            .await
            .unwrap();
    }

    pub async fn add_device(&self, path: &str, alias: &str, icon: &str) {
        let device = Device {
            alias: alias.into(),
            icon: icon.into(),
            connected: false,
        };
        self.conn.object_server().at(path, device).await.unwrap();
    }

    pub async fn set_connected(&self, path: &str, connected: bool) {
        let iface = self
            .conn
            .object_server()
            .interface::<_, Device>(path)
            .await
            .unwrap();
        iface.get_mut().await.connected = connected;
        iface
            .get()
            .await
            .connected_changed(iface.signal_emitter())
            .await
            .unwrap();
    }

    pub async fn add_battery(&self, path: &str, percentage: u8) {
        self.conn
            .object_server()
            .at(path, Battery { percentage })
            .await
            .unwrap();
    }

    pub async fn remove_battery(&self, path: &str) {
        self.conn
            .object_server()
            .remove::<Battery, _>(path)
            .await
            .unwrap();
    }
}
