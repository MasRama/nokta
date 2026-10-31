//! `Osd1`: what Windows' own OSD would show, sent as its `Show` signal. The
//! page's own interface: noktad has none, as GNOME Shell draws its OSD.

use serde_json::{json, Value};

use crate::osd::Osd;

pub const INTERFACE: &str = "Osd1";
pub const SHOW: &str = "Show";

/// The `Show` signal's arguments: kind, level and name.
pub fn show_args(osd: &Osd) -> Vec<Value> {
    vec![json!(osd.kind()), json!(osd.level()), json!(osd.name())]
}
