//! `Settings1`: the config's tables and the picture theme's image.

use nokta_core::features::settings::picture::Prepared;
use nokta_core::features::settings::{Config, Entries, SettingValue};
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "Settings1";

pub fn props(config: &Config, picture: &Prepared) -> Props {
    let mut props: Props = config
        .tables()
        .into_iter()
        .map(|(name, entries)| (name.to_owned(), Value::Object(table(entries))))
        .collect();
    props.insert("PicturePath".into(), json!(picture.path));
    props.insert("PictureColor".into(), json!(picture.color));
    props.insert("PictureTone".into(), json!(picture.tone));
    props
}

fn table(entries: Entries) -> Props {
    entries
        .into_iter()
        .map(|(key, value)| {
            let value = match value {
                SettingValue::Bool(b) => json!(b),
                SettingValue::Uint(n) => json!(n),
                SettingValue::Float(n) => json!(n),
                SettingValue::Text(s) => json!(s),
                SettingValue::List(names) => json!(names),
            };
            (key.to_owned(), value)
        })
        .collect()
}

/// The value of a `Set` call. Every number is a float: the key's own type
/// decides whether it must be whole.
pub fn setting_value(value: &Value) -> Option<SettingValue> {
    Some(match value {
        Value::Bool(b) => SettingValue::Bool(*b),
        Value::String(s) => SettingValue::Text(s.clone()),
        Value::Number(n) => SettingValue::Float(n.as_f64()?),
        Value::Array(names) => SettingValue::List(
            names
                .iter()
                .map(|name| name.as_str().map(str::to_owned))
                .collect::<Option<_>>()?,
        ),
        Value::Null | Value::Object(_) => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_keep_their_keys_and_types() {
        let props = props(&Config::default(), &Prepared::default());
        let appearance = props["Appearance"].as_object().unwrap();
        assert_eq!(appearance["height"], json!(32));
        assert_eq!(appearance["theme"], json!("midnight"));
        assert_eq!(appearance["use_album_accent"], json!(true));
        assert!(appearance["animation_speed"].is_f64());
        assert!(props["Home"]["toggles"].is_array());
        assert_eq!(props["PicturePath"], json!(""));
    }

    #[test]
    fn set_values_come_from_json() {
        assert_eq!(setting_value(&json!(true)), Some(SettingValue::Bool(true)));
        assert_eq!(setting_value(&json!(40)), Some(SettingValue::Float(40.0)));
        assert_eq!(
            setting_value(&json!("24h")),
            Some(SettingValue::Text("24h".into()))
        );
        assert_eq!(
            setting_value(&json!(["focus", "timer"])),
            Some(SettingValue::List(vec!["focus".into(), "timer".into()]))
        );
        assert_eq!(setting_value(&json!([1])), None);
        assert_eq!(setting_value(&json!(null)), None);
        assert_eq!(setting_value(&json!({})), None);
    }
}
