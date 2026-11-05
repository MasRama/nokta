//! `Plugins1`: the add-on plugins and their cards, from the core.

use nokta_core::features::plugins::{PluginAlert, PluginsState};
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "Plugins1";
pub const ALERT: &str = "Alert";

/// The `Plugins` and `Cards` properties, each row as the D-Bus struct's
/// fields in order.
pub fn props(state: &PluginsState) -> Props {
    let plugins: Vec<Value> = state
        .plugins
        .iter()
        .map(|p| json!([p.id, p.enabled, p.status, p.message, p.info]))
        .collect();
    let cards: Vec<Value> = state
        .cards
        .iter()
        .map(|(id, card)| json!([id, card]))
        .collect();
    let mut props = Props::new();
    props.insert("Plugins".into(), Value::Array(plugins));
    props.insert("Cards".into(), Value::Array(cards));
    props
}

/// `Alert`'s arguments.
pub fn alert_args(alert: &PluginAlert) -> Vec<Value> {
    vec![
        json!(alert.id),
        json!(alert.title),
        json!(alert.detail),
        json!(alert.icon),
        json!(alert.tone),
        json!(alert.important),
    ]
}
