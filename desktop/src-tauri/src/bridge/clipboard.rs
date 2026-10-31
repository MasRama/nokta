//! `Clipboard1`: the clipboard history from the core. Windows' own
//! clipboard feeds it (win/clipboard.rs), as the extension's watcher does
//! on GNOME.

use nokta_core::features::clipboard::service::Published;
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "Clipboard1";

/// `Items` (newest first: id, kind, preview, thumbnail, pinned, time) and
/// `Paused`.
pub fn props(published: &Published) -> Props {
    let rows: Vec<Value> = published
        .items
        .iter()
        .map(|row| {
            json!([
                row.id,
                row.kind,
                row.preview,
                row.thumbnail,
                row.pinned,
                row.time_us
            ])
        })
        .collect();
    let mut props = Props::new();
    props.insert("Items".into(), Value::Array(rows));
    props.insert("Paused".into(), Value::Bool(published.paused));
    props
}
