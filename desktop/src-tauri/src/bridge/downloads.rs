//! `Downloads1`: a file that finished downloading, from the core.

use nokta_core::features::downloads::service::Finished;
use serde_json::{json, Value};

pub const INTERFACE: &str = "Downloads1";
pub const FINISHED: &str = "Finished";

/// `Finished`'s arguments.
pub fn finished_args(file: &Finished) -> Vec<Value> {
    vec![
        json!(file.uri),
        json!(file.name),
        json!(file.icon),
        json!(file.size),
        json!(file.thumbnail),
    ]
}
