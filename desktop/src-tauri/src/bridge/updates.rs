//! `Updates1`: whether a newer Nokta is out on GitHub, from the core.

use nokta_core::features::updates::UpdateState;
use serde_json::json;

use super::Props;

pub const INTERFACE: &str = "Updates1";

pub fn props(s: &UpdateState) -> Props {
    let mut props = Props::new();
    props.insert("Latest".into(), json!(s.latest));
    props.insert("ReleaseUrl".into(), json!(s.url));
    props
}
