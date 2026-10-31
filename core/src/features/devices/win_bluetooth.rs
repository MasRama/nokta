//! Bluetooth audio devices from Windows: connect and disconnect alerts. A
//! device watcher on the paired Bluetooth devices reports them and their
//! connection, which `BluetoothRules` turns into alerts as for BlueZ.

use tokio::sync::mpsc;
use windows::core::{IInspectable, Interface, HSTRING};
use windows::Devices::Bluetooth::BluetoothDevice;
use windows::Devices::Enumeration::{
    DeviceInformation, DeviceInformationKind, DeviceInformationUpdate, DeviceWatcher,
};
use windows::Foundation::{IPropertyValue, TypedEventHandler};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows_collections::{IIterable, IMapView};

use super::rules::{cod_class, Alert, BluetoothRules, DeviceChange, Step};

const CONNECTED: &str = "System.Devices.Aep.IsConnected";
const MAJOR: &str = "System.Devices.Aep.Bluetooth.Cod.Major";
const MINOR: &str = "System.Devices.Aep.Bluetooth.Cod.Minor";
const NAME: &str = "System.ItemNameDisplay";

/// What the watcher reports, by the device's id.
enum Event {
    Added(String, DeviceChange),
    Updated(String, DeviceChange),
    Removed(String),
}

/// Follows the paired devices until the alerts' receiver goes away.
pub async fn run(alerts: mpsc::Sender<Alert>) {
    let (tx, mut events) = mpsc::unbounded_channel();
    let spawned = std::thread::Builder::new()
        .name("nokta-bluetooth".into())
        .spawn(move || {
            // The watcher calls back while it lives: this thread keeps it.
            match watch(tx) {
                Ok(_watcher) => loop {
                    std::thread::park();
                },
                Err(err) => tracing::warn!("no Bluetooth alerts: {err}"),
            }
        });
    if let Err(err) = spawned {
        tracing::warn!("cannot follow Bluetooth: {err}");
        return;
    }
    let mut rules = BluetoothRules::default();
    while let Some(event) = events.recv().await {
        let alert = match event {
            Event::Added(id, change) => {
                rules.add(&id, change);
                None
            }
            Event::Updated(id, change) => match rules.change(&id, change) {
                Some(Step::Alert(alert)) => Some(alert),
                // Windows gives no Bluetooth battery: nothing to wait for.
                Some(Step::Wait(wait)) => rules.wait_ended(&id, wait),
                None => None,
            },
            Event::Removed(id) => {
                rules.remove(&id);
                None
            }
        };
        if let Some(alert) = alert {
            if alerts.send(alert).await.is_err() {
                return;
            }
        }
    }
}

/// Starts a watcher on the paired Bluetooth devices that sends what it sees.
fn watch(tx: mpsc::UnboundedSender<Event>) -> windows::core::Result<DeviceWatcher> {
    // SAFETY: called once, first thing on this thread.
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }?;
    let selector = BluetoothDevice::GetDeviceSelectorFromPairingState(true)?;
    let wanted: Vec<HSTRING> = [CONNECTED, MAJOR, MINOR, NAME]
        .into_iter()
        .map(HSTRING::from)
        .collect();
    let watcher = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
        &selector,
        &IIterable::<HSTRING>::from(wanted),
        DeviceInformationKind::AssociationEndpoint,
    )?;
    let added = tx.clone();
    watcher.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
        move |_, info| {
            if let Some(info) = info.as_ref() {
                let mut change = change(&info.Properties()?);
                change.alias = change
                    .alias
                    .or(info.Name().ok().map(|n| n.to_string_lossy()));
                let _ = added.send(Event::Added(info.Id()?.to_string_lossy(), change));
            }
            Ok(())
        },
    ))?;
    let updated = tx.clone();
    watcher.Updated(
        &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
            if let Some(update) = update.as_ref() {
                let change = change(&update.Properties()?);
                let _ = updated.send(Event::Updated(update.Id()?.to_string_lossy(), change));
            }
            Ok(())
        }),
    )?;
    watcher.Removed(
        &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
            if let Some(update) = update.as_ref() {
                let _ = tx.send(Event::Removed(update.Id()?.to_string_lossy()));
            }
            Ok(())
        }),
    )?;
    watcher.Start()?;
    Ok(watcher)
}

/// The device's name, class and connection among `props`; `None` where
/// they do not say.
fn change(props: &IMapView<HSTRING, IInspectable>) -> DeviceChange {
    let value = |key: &str| {
        props
            .Lookup(&HSTRING::from(key))
            .ok()
            .and_then(|v| v.cast::<IPropertyValue>().ok())
    };
    let number = |key: &str| {
        let v = value(key)?;
        v.GetUInt32()
            .or_else(|_| v.GetUInt16().map(u32::from))
            .or_else(|_| v.GetUInt8().map(u32::from))
            .ok()
    };
    let class = number(MAJOR).map(|major| cod_class(major, number(MINOR).unwrap_or(0)));
    DeviceChange {
        alias: value(NAME)
            .and_then(|v| v.GetString().ok())
            .map(|s| s.to_string_lossy())
            .filter(|s| !s.is_empty()),
        icon: None,
        class,
        connected: value(CONNECTED).and_then(|v| v.GetBoolean().ok()),
    }
}
