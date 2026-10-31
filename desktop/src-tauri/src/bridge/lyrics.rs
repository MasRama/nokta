//! `Lyrics1`: the synced lyrics of the active track.

use nokta_core::features::lyrics::LyricsState;
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "Lyrics1";

pub fn props(s: &LyricsState) -> Props {
    let lines: Vec<Value> = s
        .lines
        .iter()
        .map(|l| json!([l.start_us, l.text]))
        .collect();
    let mut props = Props::new();
    props.insert("Status".into(), json!(s.status.as_str()));
    props.insert("Lines".into(), Value::Array(lines));
    props.insert("OffsetMs".into(), json!(s.offset_ms));
    props
}
