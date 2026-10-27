//! Bluetooth audio devices from BlueZ: connect and disconnect alerts.

use std::time::Duration;

use futures_util::StreamExt;
use tokio::sync::mpsc;
use zbus::fdo::{InterfacesAdded, InterfacesRemoved, ObjectManagerProxy, PropertiesChanged};
use zbus::message::Type;
use zbus::zvariant::Value;
use zbus::{Connection, MatchRule, MessageStream};

use super::rules::{Alert, BluetoothRules, DeviceChange, Step};

const SERVICE: &str = "org.bluez";
const DEVICE: &str = "org.bluez.Device1";
const BATTERY: &str = "org.bluez.Battery1";
/// How long a connect alert waits for the device to report its battery.
pub const BATTERY_WAIT: Duration = Duration::from_secs(2);

fn device_change<'a>(props: impl IntoIterator<Item = (&'a str, &'a Value<'a>)>) -> DeviceChange {
    let mut change = DeviceChange::default();
    for (name, value) in props {
        match name {
            "Alias" => change.alias = value.downcast_ref::<&str>().ok().map(str::to_owned),
            "Icon" => change.icon = value.downcast_ref::<&str>().ok().map(str::to_owned),
            "Class" => change.class = value.downcast_ref().ok(),
            "Connected" => change.connected = value.downcast_ref().ok(),
            _ => {}
        }
    }
    change
}

fn percentage<'a>(props: impl IntoIterator<Item = (&'a str, &'a Value<'a>)>) -> Option<u8> {
    props
        .into_iter()
        .find(|(name, _)| *name == "Percentage")
        .and_then(|(_, value)| value.downcast_ref().ok())
}

/// Follows BlueZ until the system bus goes away.
pub async fn run(conn: Connection, alerts: mpsc::Sender<Alert>) -> zbus::Result<()> {
    let changes_rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender(SERVICE)?
        .interface("org.freedesktop.DBus.Properties")?
        .member("PropertiesChanged")?
        .path_namespace("/org/bluez")?
        .build();
    let objects_rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender(SERVICE)?
        .interface("org.freedesktop.DBus.ObjectManager")?
        .path("/")?
        .build();
    let mut changes = MessageStream::for_match_rule(changes_rule, &conn, None).await?;
    let mut objects = MessageStream::for_match_rule(objects_rule, &conn, None).await?;
    let (wait_tx, mut waits) = mpsc::channel::<(String, u64)>(8);

    let mut rules = BluetoothRules::default();
    read_all(&conn, &mut rules).await;

    loop {
        let alert = tokio::select! {
            Some(Ok(message)) = changes.next() => {
                let Some(signal) = PropertiesChanged::from_message(message) else { continue };
                let (Ok(args), Some(path)) = (signal.args(), signal.message().header().path().cloned()) else { continue };
                let props = args.changed_properties().iter().map(|(k, v)| (*k, v));
                match args.interface_name.as_str() {
                    DEVICE => match rules.change(path.as_str(), device_change(props)) {
                        Some(Step::Alert(alert)) => Some(alert),
                        Some(Step::Wait(wait)) => {
                            let tx = wait_tx.clone();
                            let path = path.to_string();
                            tokio::spawn(async move {
                                tokio::time::sleep(BATTERY_WAIT).await;
                                let _ = tx.send((path, wait)).await;
                            });
                            None
                        }
                        None => None,
                    },
                    BATTERY => match percentage(props) {
                        Some(value) => rules.battery(path.as_str(), Some(value)),
                        None => None,
                    },
                    _ => None,
                }
            }
            Some(Ok(message)) = objects.next() => {
                if let Some(signal) = InterfacesAdded::from_message(message.clone()) {
                    let Ok(args) = signal.args() else { continue };
                    let path = args.object_path.as_str();
                    let mut alert = None;
                    for (interface, props) in args.interfaces_and_properties() {
                        let props = props.iter().map(|(k, v)| (*k, v));
                        match interface.as_str() {
                            DEVICE => rules.add(path, device_change(props)),
                            BATTERY => alert = rules.battery(path, percentage(props)).or(alert),
                            _ => {}
                        }
                    }
                    alert
                } else if let Some(signal) = InterfacesRemoved::from_message(message) {
                    let Ok(args) = signal.args() else { continue };
                    let path = args.object_path.as_str();
                    for interface in args.interfaces().iter() {
                        match interface.as_str() {
                            DEVICE => rules.remove(path),
                            BATTERY => { rules.battery(path, None); }
                            _ => {}
                        }
                    }
                    None
                } else {
                    None
                }
            }
            Some((path, wait)) = waits.recv() => rules.wait_ended(&path, wait),
            else => return Ok(()),
        };
        if let Some(alert) = alert {
            if alerts.send(alert).await.is_err() {
                return Ok(());
            }
        }
    }
}

/// Remembers every device BlueZ knows. Logs when BlueZ is not there; devices
/// then arrive through `InterfacesAdded` once it starts.
async fn read_all(conn: &Connection, rules: &mut BluetoothRules) {
    let result = async {
        ObjectManagerProxy::builder(conn)
            .destination(SERVICE)?
            .path("/")?
            .build()
            .await?
            .get_managed_objects()
            .await
            .map_err(zbus::Error::from)
    }
    .await;
    let objects = match result {
        Ok(objects) => objects,
        Err(err) => {
            tracing::info!("no Bluetooth alerts until BlueZ appears: {err}");
            return;
        }
    };
    for (path, interfaces) in &objects {
        for (interface, props) in interfaces {
            let props = props.iter().map(|(k, v)| (k.as_str(), &**v));
            match interface.as_str() {
                DEVICE => rules.add(path.as_str(), device_change(props)),
                BATTERY => {
                    rules.battery(path.as_str(), percentage(props));
                }
                _ => {}
            }
        }
    }
}
