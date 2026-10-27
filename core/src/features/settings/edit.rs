//! Changes one key of config.toml, keeping the rest of the file as it is.

use toml_edit::{DocumentMut, Item, Table};
use zbus::zvariant::Value;

use super::config::{parse, Config, ConfigError};

/// `text` with `[table] key` set to `value`. The result is checked like a
/// loaded file; on any error nothing is changed. Comments, order and the
/// value's trailing comment are kept. A missing key or table is added.
pub fn set_key(
    text: &str,
    table: &str,
    key: &str,
    value: &Value<'_>,
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

/// The D-Bus signature of the key's published value: `b`, `u`, `d` or `s`.
fn expected_type(table: &str, key: &str) -> Result<String, ConfigError> {
    let defaults = Config::default();
    let map = match table {
        "appearance" => defaults.appearance.to_dbus(),
        "behavior" => defaults.behavior.to_dbus(),
        "lyrics" => defaults.lyrics.to_dbus(),
        "timer" => defaults.timer.to_dbus(),
        _ => {
            return Err(ConfigError::invalid(format!(
                "unknown settings table {table:?}"
            )))
        }
    };
    map.get(key)
        .map(|v| v.value_signature().to_string())
        .ok_or_else(|| ConfigError::invalid(format!("unknown setting {table}.{key}")))
}

fn toml_value(
    name: &str,
    expected: String,
    value: &Value<'_>,
) -> Result<toml_edit::Value, ConfigError> {
    let wrong = |what: &str| ConfigError::invalid(format!("{name} must be {what}, got {value}"));
    match expected.as_str() {
        "b" => match value {
            Value::Bool(b) => Ok((*b).into()),
            _ => Err(wrong("true or false")),
        },
        "u" => match number(value) {
            Some(n) if n.fract() == 0.0 && n >= 0.0 => Ok((n as i64).into()),
            Some(_) => Err(wrong("a whole number from 0")),
            None => Err(wrong("a number")),
        },
        "d" => number(value)
            .map(Into::into)
            .ok_or_else(|| wrong("a number")),
        "s" => match value {
            Value::Str(s) => Ok(s.as_str().into()),
            _ => Err(wrong("a string")),
        },
        other => Err(ConfigError::invalid(format!(
            "{name} has unsupported type {other}"
        ))),
    }
}

fn number(value: &Value<'_>) -> Option<f64> {
    Some(match value {
        Value::U8(n) => f64::from(*n),
        Value::I16(n) => f64::from(*n),
        Value::U16(n) => f64::from(*n),
        Value::I32(n) => f64::from(*n),
        Value::U32(n) => f64::from(*n),
        Value::I64(n) => *n as f64,
        Value::U64(n) => *n as f64,
        Value::F64(n) if n.is_finite() => *n,
        _ => return None,
    })
}
