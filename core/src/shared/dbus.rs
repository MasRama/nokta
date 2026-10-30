//! Helpers for publishing feature state as D-Bus properties, and for
//! hearing when the system resumes from suspend.

use std::borrow::Cow;
use std::collections::HashMap;

use futures_util::StreamExt;
use tokio::sync::watch;
use zbus::fdo::Properties;
use zbus::message::Type;
use zbus::names::InterfaceName;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedValue, Value};
use zbus::{Connection, MatchRule, MessageStream};

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

/// Counts the system's resumes from suspend (logind's
/// `PrepareForSleep(false)`), so what waits for a time of day can look at
/// the clock again. Without a system bus the count never changes.
pub fn resumes(system: Option<Connection>) -> watch::Receiver<u64> {
    let (tx, rx) = watch::channel(0);
    tokio::spawn(async move {
        if let Some(system) = system {
            if let Err(err) = count_resumes(&system, &tx).await {
                tracing::warn!("resumes from suspend go unnoticed: {err}");
            }
        }
        // Keeps the count alive, so watchers wait instead of ending.
        std::future::pending::<()>().await;
    });
    rx
}

async fn count_resumes(system: &Connection, tx: &watch::Sender<u64>) -> zbus::Result<()> {
    let rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender("org.freedesktop.login1")?
        .interface("org.freedesktop.login1.Manager")?
        .member("PrepareForSleep")?
        .build();
    let mut stream = MessageStream::for_match_rule(rule, system, None).await?;
    while let Some(message) = stream.next().await {
        let Ok(message) = message else { continue };
        // PrepareForSleep(false) comes after resuming.
        if let Ok(false) = message.body().deserialize::<bool>() {
            tx.send_modify(|count| *count += 1);
        }
    }
    Ok(())
}
