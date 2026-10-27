//! Runs the UPower and BlueZ followers and merges their alerts.

use tokio::sync::mpsc;
use zbus::Connection;

use super::rules::Alert;
use super::{bluez, upower};

/// Starts following the system bus. Without one, the receiver never yields.
pub fn spawn(system: Option<Connection>) -> mpsc::Receiver<Alert> {
    let (tx, rx) = mpsc::channel(16);
    if let Some(conn) = system {
        let (battery_conn, battery_tx) = (conn.clone(), tx.clone());
        tokio::spawn(async move {
            if let Err(err) = upower::run(battery_conn, battery_tx).await {
                tracing::warn!("battery alerts stopped: {err}");
            }
        });
        tokio::spawn(async move {
            if let Err(err) = bluez::run(conn, tx).await {
                tracing::warn!("Bluetooth alerts stopped: {err}");
            }
        });
    }
    rx
}
