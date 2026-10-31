//! `Nokta1`: which core the page talks to.

use serde_json::json;

use super::Props;

pub const INTERFACE: &str = "Nokta1";

pub fn props() -> Props {
    let mut props = Props::new();
    props.insert("ApiVersion".into(), json!(1));
    props.insert("DaemonVersion".into(), json!(env!("CARGO_PKG_VERSION")));
    props
}
