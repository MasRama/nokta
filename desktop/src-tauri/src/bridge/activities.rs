//! `Activities1`: the live activities apps and scripts show, from the core.
//!
//! On D-Bus each start time is on the monotonic clock; here it is on the
//! wall clock in µs, the page's `Date.now() * 1000`, as `Timer1`'s.

use nokta_core::features::activities::model::{Activity, Ended};
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "Activities1";
pub const ENDED: &str = "Ended";

/// The `Activities` property, newest first, each as the D-Bus struct's
/// fields in order.
pub fn props(activities: &[Activity], now_mono_us: i64, now_wall_us: i64) -> Props {
    let list: Vec<Value> = activities
        .iter()
        .map(|a| {
            json!([
                a.id,
                a.title,
                a.detail,
                a.icon,
                a.progress,
                now_wall_us - (now_mono_us - a.started_us)
            ])
        })
        .collect();
    let mut props = Props::new();
    props.insert("Activities".into(), Value::Array(list));
    props
}

/// `Ended`'s arguments.
pub fn ended_args(ended: &Ended) -> Vec<Value> {
    vec![
        json!(ended.id),
        json!(ended.title),
        json!(ended.success),
        json!(ended.message),
        json!(ended.elapsed_us),
    ]
}

#[cfg(test)]
mod tests {
    use nokta_core::features::activities::model::{Activities, Update};

    use super::*;

    #[test]
    fn stamps_each_start_on_the_wall_clock() {
        let mut activities = Activities::default();
        let update = Update {
            title: "Build".into(),
            detail: "cargo".into(),
            icon: String::new(),
            progress: 0.5,
        };
        activities.set("build", update, 1_000).unwrap();
        let props = props(activities.list(), 4_000, 1_700_000_000_000_000);
        assert_eq!(
            props["Activities"],
            json!([[
                "build",
                "Build",
                "cargo",
                "",
                0.5,
                1_699_999_999_997_000_i64
            ]])
        );
    }
}
