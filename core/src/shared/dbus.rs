//! Helpers for publishing feature state as D-Bus properties.

use std::borrow::Cow;
use std::collections::HashMap;

use tokio::sync::watch;
use zbus::fdo::Properties;
use zbus::names::InterfaceName;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedValue, Value};
use zbus::Connection;

/// Every property of an interface as (D-Bus name, current value).
pub type PropertyList = Vec<(&'static str, OwnedValue)>;

/// Converts a plain value (no file descriptors) into an `OwnedValue`.
pub fn owned<'a>(value: impl Into<Value<'a>>) -> OwnedValue {
    value
        .into()
        .try_to_owned()
        .expect("value without file descriptors")
}

/// Emits one `PropertiesChanged` per state change, carrying every property
/// whose value differs from the previous state.
pub fn spawn_change_forwarder<S: Send + Sync + 'static>(
    conn: Connection,
    path: &'static str,
    interface: &'static str,
    mut state: watch::Receiver<S>,
    properties: fn(&S) -> PropertyList,
) {
    tokio::spawn(async move {
        let emitter = SignalEmitter::new(&conn, path).expect("static object path is valid");
        let interface = InterfaceName::from_static_str_unchecked(interface);
        let mut last = properties(&state.borrow_and_update());
        while state.changed().await.is_ok() {
            let next = properties(&state.borrow_and_update());
            let changed: HashMap<&str, Value<'_>> = next
                .iter()
                .zip(&last)
                .filter(|((_, new), (_, old))| new != old)
                .filter_map(|((name, value), _)| Some((*name, value.try_clone().ok()?.into())))
                .collect();
            if !changed.is_empty() {
                let sent = Properties::properties_changed(
                    &emitter,
                    interface.clone(),
                    changed,
                    Cow::Borrowed(&[]),
                )
                .await;
                if let Err(err) = sent {
                    tracing::warn!(%err, %interface, "cannot emit PropertiesChanged");
                }
            }
            last = next;
        }
    });
}
