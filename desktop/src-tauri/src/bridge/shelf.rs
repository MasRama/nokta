//! `Shelf1`: the files parked on the notch, and their thumbnails, from the
//! core.

use nokta_core::features::shelf::model::Item;
use nokta_core::features::shelf::service::Thumbnails;
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "Shelf1";

/// The `Items` property: URI, name and icon, oldest first.
pub fn items_props(items: &[Item]) -> Props {
    let rows: Vec<Value> = items
        .iter()
        .map(|item| json!([item.uri, item.name, item.icon]))
        .collect();
    let mut props = Props::new();
    props.insert("Items".into(), Value::Array(rows));
    props
}

/// The `Thumbnails` property: item URI to a PNG's path.
pub fn thumbnails_props(thumbnails: &Thumbnails) -> Props {
    let mut props = Props::new();
    props.insert("Thumbnails".into(), json!(thumbnails));
    props
}

/// Both properties.
pub fn props(items: &[Item], thumbnails: &Thumbnails) -> Props {
    let mut props = items_props(items);
    props.extend(thumbnails_props(thumbnails));
    props
}

/// The URIs `Add` takes, or None when an argument is not a list of strings.
pub fn uris(arg: &Value) -> Option<Vec<String>> {
    arg.as_array()?
        .iter()
        .map(|uri| uri.as_str().map(str::to_owned))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_takes_a_list_of_strings_only() {
        assert_eq!(
            uris(&json!(["file:///a", "file:///b"])),
            Some(vec!["file:///a".to_owned(), "file:///b".to_owned()])
        );
        assert_eq!(uris(&json!(["file:///a", 1])), None);
        assert_eq!(uris(&json!("file:///a")), None);
    }
}
