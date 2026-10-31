//! `Weather1`: the weather the core last read for the configured place.

use nokta_core::features::weather::WeatherState;
use serde_json::json;

use super::Props;

pub const INTERFACE: &str = "Weather1";

/// The properties, with empty values while there is no reading.
pub fn props(s: &WeatherState) -> Props {
    let mut props = Props::new();
    props.insert("Status".into(), json!(s.status.as_str()));
    props.insert("Units".into(), json!(s.units.as_str()));
    let (place, temperature, high, low, condition, is_day) = match &s.reading {
        Some(r) => (
            r.place.as_str(),
            r.temperature,
            r.high,
            r.low,
            r.condition.as_str(),
            r.is_day,
        ),
        None => ("", 0.0, 0.0, 0.0, "", false),
    };
    props.insert("Place".into(), json!(place));
    props.insert("Temperature".into(), json!(temperature));
    props.insert("High".into(), json!(high));
    props.insert("Low".into(), json!(low));
    props.insert("Condition".into(), json!(condition));
    props.insert("IsDay".into(), json!(is_day));
    props
}
