//! The laptop battery from UPower: charger, low, critical and full alerts.

use std::collections::HashMap;

use futures_util::StreamExt;
use tokio::sync::mpsc;
use zbus::fdo::{PropertiesChanged, PropertiesProxy};
use zbus::message::Type;
use zbus::names::InterfaceName;
use zbus::zvariant::Value;
use zbus::{Connection, MatchRule, MessageStream};

use super::rules::{Alert, BatteryRules, BatterySample};

const SERVICE: &str = "org.freedesktop.UPower";
const PATH: &str = "/org/freedesktop/UPower";
const DISPLAY_DEVICE: &str = "/org/freedesktop/UPower/devices/DisplayDevice";
const DEVICE_INTERFACE: &str = "org.freedesktop.UPower.Device";
/// `org.freedesktop.UPower.Device.State` for a fully charged battery.
const FULLY_CHARGED: u32 = 4;

#[derive(Debug, Default)]
struct Battery {
    on_battery: bool,
    present: bool,
    state: u32,
    percentage: f64,
}

impl Battery {
    fn set(&mut self, name: &str, value: &Value<'_>) {
        match name {
            "OnBattery" => self.on_battery = value.downcast_ref().unwrap_or(self.on_battery),
            "IsPresent" => self.present = value.downcast_ref().unwrap_or(self.present),
            "State" => self.state = value.downcast_ref().unwrap_or(self.state),
            "Percentage" => self.percentage = value.downcast_ref().unwrap_or(self.percentage),
            _ => {}
        }
    }

    fn sample(&self) -> BatterySample {
        BatterySample {
            present: self.present,
            on_battery: self.on_battery,
            full: self.state == FULLY_CHARGED,
            percentage: self.percentage,
        }
    }
}

/// Follows UPower until the system bus goes away. Every change of the
/// charger or the display device is run through `BatteryRules`.
pub async fn run(conn: Connection, alerts: mpsc::Sender<Alert>) -> zbus::Result<()> {
    let rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender(SERVICE)?
        .interface("org.freedesktop.DBus.Properties")?
        .member("PropertiesChanged")?
        .path_namespace(PATH)?
        .build();
    let mut changes = MessageStream::for_match_rule(rule, &conn, None).await?;

    let mut battery = Battery::default();
    let mut rules = BatteryRules::default();
    let mut known = read_all(&conn, &mut battery).await;
    if known {
        rules.update(battery.sample());
    }

    while let Some(message) = changes.next().await {
        let Ok(message) = message else { continue };
        let Some(signal) = PropertiesChanged::from_message(message) else {
            continue;
        };
        let (Ok(args), Some(path)) = (signal.args(), signal.message().header().path().cloned())
        else {
            continue;
        };
        let wanted = match path.as_str() {
            PATH => args.interface_name.as_str() == SERVICE,
            DISPLAY_DEVICE => args.interface_name.as_str() == DEVICE_INTERFACE,
            _ => false,
        };
        if !wanted {
            continue;
        }
        if known {
            for (name, value) in args.changed_properties() {
                battery.set(name, value);
            }
        } else {
            // UPower started after noktad: its first signal is the start.
            known = read_all(&conn, &mut battery).await;
            if known {
                rules.update(battery.sample());
            }
            continue;
        }
        for alert in rules.update(battery.sample()) {
            if alerts.send(alert).await.is_err() {
                return Ok(());
            }
        }
    }
    Ok(())
}

/// Reads every property we need. Logs and returns false when UPower is not there.
async fn read_all(conn: &Connection, battery: &mut Battery) -> bool {
    let result = async {
        for (path, interface) in [(PATH, SERVICE), (DISPLAY_DEVICE, DEVICE_INTERFACE)] {
            let props = get_all(conn, path, interface).await?;
            for (name, value) in &props {
                battery.set(name, value);
            }
        }
        zbus::Result::Ok(())
    }
    .await;
    match result {
        Ok(()) => true,
        Err(err) => {
            tracing::info!("no battery alerts until UPower appears: {err}");
            false
        }
    }
}

async fn get_all(
    conn: &Connection,
    path: &'static str,
    interface: &'static str,
) -> zbus::Result<HashMap<String, zbus::zvariant::OwnedValue>> {
    let proxy = PropertiesProxy::builder(conn)
        .destination(SERVICE)?
        .path(path)?
        .cache_properties(zbus::proxy::CacheProperties::No)
        .build()
        .await?;
    Ok(proxy
        .get_all(InterfaceName::from_static_str_unchecked(interface))
        .await?)
}
