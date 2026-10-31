//! `Devices1`: the device alerts, sent as its `Alert` signal.

use nokta_core::features::devices::rules::Alert;
use serde_json::{json, Value};

pub const INTERFACE: &str = "Devices1";
pub const ALERT: &str = "Alert";

/// The `Alert` signal's arguments: kind, name and percentage.
pub fn alert_args(alert: &Alert) -> Vec<Value> {
    vec![
        json!(alert.kind.as_str()),
        json!(alert.name),
        json!(alert.percentage),
    ]
}
