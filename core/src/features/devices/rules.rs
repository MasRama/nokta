//! Pure rules: which battery and Bluetooth changes become alerts.

use std::collections::HashMap;

/// Battery percentage at or below which `BatteryLow` is sent.
pub const LOW_PERCENT: i32 = 20;
/// Battery percentage at or below which `BatteryCritical` is sent.
pub const CRITICAL_PERCENT: i32 = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    BluetoothConnected,
    BluetoothDisconnected,
    ChargerPlugged,
    ChargerUnplugged,
    BatteryLow,
    BatteryCritical,
    BatteryFull,
}

impl Kind {
    /// The `kind` argument of `io.nokta.Devices1.Alert`.
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::BluetoothConnected => "bluetooth-connected",
            Kind::BluetoothDisconnected => "bluetooth-disconnected",
            Kind::ChargerPlugged => "charger-plugged",
            Kind::ChargerUnplugged => "charger-unplugged",
            Kind::BatteryLow => "battery-low",
            Kind::BatteryCritical => "battery-critical",
            Kind::BatteryFull => "battery-full",
        }
    }
}

/// One `io.nokta.Devices1.Alert`. `percentage` is -1 when unknown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Alert {
    pub kind: Kind,
    pub name: String,
    pub percentage: i32,
}

impl Alert {
    pub fn battery(kind: Kind, percentage: i32) -> Alert {
        Alert {
            kind,
            name: String::new(),
            percentage,
        }
    }

    pub fn device(kind: Kind, name: &str, percentage: i32) -> Alert {
        Alert {
            kind,
            name: name.to_owned(),
            percentage,
        }
    }
}

/// The laptop battery as UPower reports it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BatterySample {
    pub present: bool,
    pub on_battery: bool,
    pub full: bool,
    pub percentage: f64,
}

/// Turns successive battery samples into charger, low, critical and full
/// alerts. The first sample only sets the starting point.
#[derive(Debug, Default)]
pub struct BatteryRules {
    last: Option<BatterySample>,
    low_sent: bool,
    critical_sent: bool,
    full_sent: bool,
}

impl BatteryRules {
    pub fn update(&mut self, sample: BatterySample) -> Vec<Alert> {
        let percentage = sample.percentage.round().clamp(0.0, 100.0) as i32;
        if !sample.present {
            self.last = None;
            return Vec::new();
        }
        let Some(last) = self.last.replace(sample) else {
            self.low_sent = percentage <= LOW_PERCENT;
            self.critical_sent = percentage <= CRITICAL_PERCENT;
            self.full_sent = sample.full;
            return Vec::new();
        };

        let mut alerts = Vec::new();
        if sample.on_battery != last.on_battery {
            let kind = if sample.on_battery {
                Kind::ChargerUnplugged
            } else {
                Kind::ChargerPlugged
            };
            alerts.push(Alert::battery(kind, percentage));
        }

        if percentage > LOW_PERCENT {
            self.low_sent = false;
        }
        if percentage > CRITICAL_PERCENT {
            self.critical_sent = false;
        }
        if sample.on_battery {
            if percentage <= CRITICAL_PERCENT && !self.critical_sent {
                self.critical_sent = true;
                self.low_sent = true;
                alerts.push(Alert::battery(Kind::BatteryCritical, percentage));
            } else if percentage <= LOW_PERCENT && !self.low_sent {
                self.low_sent = true;
                alerts.push(Alert::battery(Kind::BatteryLow, percentage));
            }
        }

        if !sample.full {
            self.full_sent = false;
        } else if !sample.on_battery && !self.full_sent {
            self.full_sent = true;
            alerts.push(Alert::battery(Kind::BatteryFull, percentage));
        }
        alerts
    }
}

/// Whether a Bluetooth device is headphones, a headset or a speaker: its
/// icon says `audio-...` or its class of device is Audio/Video.
pub fn is_audio(icon: &str, class: u32) -> bool {
    icon.starts_with("audio-") || (class >> 8) & 0x1f == 4
}

/// The `org.bluez.Device1` properties that changed; `None` means unchanged.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DeviceChange {
    pub alias: Option<String>,
    pub icon: Option<String>,
    pub class: Option<u32>,
    pub connected: Option<bool>,
}

/// What to do after a Bluetooth change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Alert(Alert),
    /// Wait for the battery, then call `wait_ended` with this id.
    Wait(u64),
}

#[derive(Debug, Default)]
struct Device {
    alias: String,
    icon: String,
    class: u32,
    connected: bool,
    battery: Option<i32>,
    waiting: Option<u64>,
}

impl Device {
    fn merge(&mut self, change: DeviceChange) {
        if let Some(alias) = change.alias {
            self.alias = alias;
        }
        if let Some(icon) = change.icon {
            self.icon = icon;
        }
        if let Some(class) = change.class {
            self.class = class;
        }
    }
}

/// Turns BlueZ device changes into connect and disconnect alerts for audio
/// devices. Devices seen for the first time never raise an alert.
#[derive(Debug, Default)]
pub struct BluetoothRules {
    devices: HashMap<String, Device>,
    next_wait: u64,
}

impl BluetoothRules {
    /// Remembers a device found at startup or added later, without an alert.
    pub fn add(&mut self, path: &str, change: DeviceChange) {
        let device = self.devices.entry(path.to_owned()).or_default();
        if let Some(connected) = change.connected {
            device.connected = connected;
        }
        device.merge(change);
    }

    pub fn remove(&mut self, path: &str) {
        self.devices.remove(path);
    }

    pub fn change(&mut self, path: &str, change: DeviceChange) -> Option<Step> {
        let Some(device) = self.devices.get_mut(path) else {
            self.add(path, change);
            return None;
        };
        let connected = change.connected;
        device.merge(change);
        match connected {
            Some(true) if !device.connected => {
                device.connected = true;
                if !is_audio(&device.icon, device.class) {
                    return None;
                }
                if let Some(percentage) = device.battery {
                    return Some(Step::Alert(Alert::device(
                        Kind::BluetoothConnected,
                        &device.alias,
                        percentage,
                    )));
                }
                self.next_wait += 1;
                device.waiting = Some(self.next_wait);
                Some(Step::Wait(self.next_wait))
            }
            Some(false) if device.connected => {
                device.connected = false;
                device.waiting = None;
                device.battery = None;
                is_audio(&device.icon, device.class).then(|| {
                    Step::Alert(Alert::device(
                        Kind::BluetoothDisconnected,
                        &device.alias,
                        -1,
                    ))
                })
            }
            _ => None,
        }
    }

    /// The device's `org.bluez.Battery1.Percentage` appeared, changed or
    /// went away. Sends the connect alert a connection was waiting for.
    pub fn battery(&mut self, path: &str, percentage: Option<u8>) -> Option<Alert> {
        let device = self.devices.entry(path.to_owned()).or_default();
        device.battery = percentage.map(i32::from);
        let percentage = device.battery?;
        device.waiting.take()?;
        Some(Alert::device(
            Kind::BluetoothConnected,
            &device.alias,
            percentage,
        ))
    }

    /// The wait for the battery ran out: sends the connect alert without it,
    /// unless the battery came first or the device disconnected since.
    pub fn wait_ended(&mut self, path: &str, wait: u64) -> Option<Alert> {
        let device = self.devices.get_mut(path)?;
        if device.waiting != Some(wait) {
            return None;
        }
        device.waiting = None;
        Some(Alert::device(Kind::BluetoothConnected, &device.alias, -1))
    }
}
