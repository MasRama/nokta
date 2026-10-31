//! Runs the battery and Bluetooth followers and merges their alerts: UPower
//! and BlueZ on Linux, Windows' power callbacks and device watcher there.

use tokio::sync::mpsc;
#[cfg(target_os = "linux")]
use zbus::Connection;

use super::rules::Alert;
#[cfg(target_os = "linux")]
use super::{bluez, upower};
#[cfg(windows)]
use super::{win_bluetooth, win_power};

/// Starts following the system bus. Without one, the receiver never yields.
#[cfg(target_os = "linux")]
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

/// Starts following the battery and the paired Bluetooth devices.
#[cfg(windows)]
pub fn spawn() -> mpsc::Receiver<Alert> {
    let (tx, rx) = mpsc::channel(16);
    tokio::spawn(win_power::run(tx.clone()));
    tokio::spawn(win_bluetooth::run(tx));
    rx
}
