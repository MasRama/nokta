//! Changes one key of config.toml, keeping the rest of the file as it is.

use toml_edit::{DocumentMut, Item, Table};

use super::config::{parse, Config, ConfigError, SettingValue};

/// `text` with `[table] key` set to `value`. The result is checked like a
/// loaded file; on any error nothing is changed. Comments, order and the
/// value's trailing comment are kept. A missing key or table is added.
pub fn set_key(
    text: &str,
    table: &str,
    key: &str,
    value: &SettingValue,
) -> Result<String, ConfigError> {
    // The window can only point at the file; the user fixes it there.
    parse(text).map_err(|err| {
        let at = if err.line.is_some() { " at" } else { ":" };
        ConfigError::invalid(format!("config.toml has an error{at} {err}; fix it first"))
    })?;
    let name = format!("{table}.{key}");
    let new = toml_value(&name, expected_type(table, key)?, value)?;

    let mut doc: DocumentMut = text
        .parse()
        .map_err(|err| ConfigError::invalid(format!("cannot edit config.toml: {err}")))?;
    let entry = doc.entry(table).or_insert(Item::Table(Table::new()));
    let Some(table) = entry.as_table_like_mut() else {
        return Err(ConfigError::invalid(format!("[{table}] is not a table")));
    };
    match table.get_mut(key).and_then(Item::as_value_mut) {
        Some(old) => {
            let decor = old.decor().clone();
            *old = new;
            *old.decor_mut() = decor;
        }
        None => {
            table.insert(key, Item::Value(new));
        }
    }

    let text = doc.to_string();
    // Positions in the edited text mean nothing to the caller; name the key.
    parse(&text).map_err(|err| match err.line {
        Some(_) => ConfigError::invalid(format!("{name}: {}", err.message)),
        None => err,
    })?;
    Ok(text)
}

/// The key's default value, which gives the type a new value must have.
fn expected_type(table: &str, key: &str) -> Result<SettingValue, ConfigError> {
    let defaults = Config::default();
    let entries = match table {
        "appearance" => defaults.appearance.entries(),
        "behavior" => defaults.behavior.entries(),
        "media" => defaults.media.entries(),
        "lyrics" => defaults.lyrics.entries(),
        "timer" => defaults.timer.entries(),
        "notifications" => defaults.notifications.entries(),
        "activities" => defaults.activities.entries(),
        "weather" => defaults.weather.entries(),
        "calendar" => defaults.calendar.entries(),
        "clipboard" => defaults.clipboard.entries(),
        "downloads" => defaults.downloads.entries(),
        "home" => defaults.home.entries(),
        _ => {
            return Err(ConfigError::invalid(format!(
                "unknown settings table {table:?}"
            )))
        }
    };
    entries
        .into_iter()
        .find(|(name, _)| *name == key)
        .map(|(_, value)| value)
        .ok_or_else(|| ConfigError::invalid(format!("unknown setting {table}.{key}")))
}

fn toml_value(
    name: &str,
    expected: SettingValue,
    value: &SettingValue,
) -> Result<toml_edit::Value, ConfigError> {
    let wrong = |what: &str| ConfigError::invalid(format!("{name} must be {what}, got {value}"));
    match expected {
        SettingValue::Bool(_) => match value {
            SettingValue::Bool(b) => Ok((*b).into()),
            _ => Err(wrong("true or false")),
        },
        SettingValue::Uint(_) => match number(value) {
            Some(n) if n.fract() == 0.0 && n >= 0.0 => Ok((n as i64).into()),
            Some(_) => Err(wrong("a whole number from 0")),
            None => Err(wrong("a number")),
        },
        SettingValue::Float(_) => number(value)
            .map(Into::into)
            .ok_or_else(|| wrong("a number")),
        SettingValue::Text(_) => match value {
            SettingValue::Text(s) => Ok(s.as_str().into()),
            _ => Err(wrong("a string")),
        },
        SettingValue::List(_) => match value {
            SettingValue::List(names) => Ok(names.iter().collect::<toml_edit::Array>().into()),
            _ => Err(wrong("a list of names")),
        },
    }
}

fn number(value: &SettingValue) -> Option<f64> {
    match value {
        SettingValue::Uint(n) => Some(f64::from(*n)),
        SettingValue::Float(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}
