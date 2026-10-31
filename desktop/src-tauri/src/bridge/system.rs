//! `System1`: the system's use while a page watches it, and the memory
//! alert, from the core. JSON has no NaN: an unknown temperature is null.

use nokta_core::features::system::model::Usage;
use nokta_core::features::system::service::MemoryLow;
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "System1";
pub const MEMORY_LOW: &str = "MemoryLow";

/// The `Usage` property, as the D-Bus struct's fields in order.
pub fn props(usage: &Usage) -> Props {
    let temperature = if usage.temperature.is_finite() {
        json!(usage.temperature)
    } else {
        Value::Null
    };
    let mut props = Props::new();
    props.insert(
        "Usage".into(),
        json!([
            usage.cpu,
            usage.memory_used,
            usage.memory_total,
            temperature,
            usage.download,
            usage.upload
        ]),
    );
    props
}

/// `MemoryLow`'s arguments.
pub fn memory_low_args(low: &MemoryLow) -> Vec<Value> {
    vec![json!(low.used), json!(low.total), json!(low.app)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_temperature_is_null() {
        let props = props(&Usage::default());
        assert_eq!(props["Usage"], json!([0.0, 0, 0, null, 0.0, 0.0]));
    }

    #[test]
    fn a_known_temperature_is_a_number() {
        let usage = Usage {
            cpu: 0.25,
            memory_used: 4,
            memory_total: 16,
            temperature: 45.5,
            download: 10.0,
            upload: 2.0,
        };
        assert_eq!(
            props(&usage)["Usage"],
            json!([0.25, 4, 16, 45.5, 10.0, 2.0])
        );
    }
}
