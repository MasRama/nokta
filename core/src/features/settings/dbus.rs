//! `io.nokta.Settings1` at `/io/nokta/Settings`.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use tokio::sync::{watch, Mutex};
use zbus::fdo;
use zbus::zvariant::{OwnedValue, Str, Value};
use zbus::Connection;

use super::edit::set_key;
use super::{Config, Entries, SettingValue, DEFAULT_CONFIG_TOML};
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Settings";
pub const INTERFACE: &str = "io.nokta.Settings1";

/// Serves the config; `Set` and `Reset` write `path`, and the file watcher
/// publishes the result.
pub async fn serve(
    conn: &Connection,
    config: watch::Receiver<Config>,
    path: PathBuf,
) -> zbus::Result<()> {
    conn.object_server()
        .at(
            PATH,
            SettingsInterface {
                config: config.clone(),
                path,
                writing: Mutex::new(()),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, config, properties);
    Ok(())
}

fn properties(c: &Config) -> PropertyList {
    vec![
        ("Appearance", owned(dbus_map(c.appearance.entries()))),
        ("Behavior", owned(dbus_map(c.behavior.entries()))),
        ("Lyrics", owned(dbus_map(c.lyrics.entries()))),
        ("Timer", owned(dbus_map(c.timer.entries()))),
        ("Notifications", owned(dbus_map(c.notifications.entries()))),
        ("Activities", owned(dbus_map(c.activities.entries()))),
        ("Weather", owned(dbus_map(c.weather.entries()))),
        ("Calendar", owned(dbus_map(c.calendar.entries()))),
        ("Clipboard", owned(dbus_map(c.clipboard.entries()))),
        ("Home", owned(dbus_map(c.home.entries()))),
    ]
}

/// A config table as `a{sv}`.
fn dbus_map(entries: Entries) -> HashMap<String, OwnedValue> {
    entries
        .into_iter()
        .map(|(key, value)| {
            let value = match value {
                SettingValue::Bool(b) => b.into(),
                SettingValue::Uint(n) => n.into(),
                SettingValue::Float(n) => n.into(),
                SettingValue::Text(s) => OwnedValue::from(Str::from(s)),
                SettingValue::List(names) => owned(names),
            };
            (key.to_owned(), value)
        })
        .collect()
}

/// The value of a `Set` call. Unsigned integers stay whole numbers; other
/// numbers become floats, so `set_key` can say what is wrong with them.
fn setting_value(value: &Value<'_>) -> Option<SettingValue> {
    Some(match value {
        Value::Bool(b) => SettingValue::Bool(*b),
        Value::Str(s) => SettingValue::Text(s.as_str().to_owned()),
        Value::U8(n) => SettingValue::Uint(u32::from(*n)),
        Value::U16(n) => SettingValue::Uint(u32::from(*n)),
        Value::U32(n) => SettingValue::Uint(*n),
        Value::I16(n) => SettingValue::Float(f64::from(*n)),
        Value::I32(n) => SettingValue::Float(f64::from(*n)),
        Value::I64(n) => SettingValue::Float(*n as f64),
        Value::U64(n) => SettingValue::Float(*n as f64),
        Value::F64(n) => SettingValue::Float(*n),
        Value::Array(names) if names.element_signature() == "s" => SettingValue::List(
            names
                .iter()
                .filter_map(|name| match name {
                    Value::Str(s) => Some(s.as_str().to_owned()),
                    _ => None,
                })
                .collect(),
        ),
        _ => return None,
    })
}

/// Writes next to the file and renames it over, so nobody reads half a file.
async fn write_atomically(path: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let mut name = path.file_name().unwrap_or_default().to_owned();
    name.push(".tmp");
    let tmp = path.with_file_name(name);
    tokio::fs::write(&tmp, text).await?;
    tokio::fs::rename(&tmp, path).await
}

struct SettingsInterface {
    config: watch::Receiver<Config>,
    path: PathBuf,
    /// One read-change-write at a time, so quick changes never lose one.
    writing: Mutex<()>,
}

#[zbus::interface(name = "io.nokta.Settings1")]
impl SettingsInterface {
    #[zbus(property)]
    fn appearance(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().appearance.entries())
    }

    #[zbus(property)]
    fn behavior(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().behavior.entries())
    }

    #[zbus(property)]
    fn lyrics(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().lyrics.entries())
    }

    #[zbus(property)]
    fn timer(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().timer.entries())
    }

    #[zbus(property)]
    fn notifications(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().notifications.entries())
    }

    #[zbus(property)]
    fn activities(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().activities.entries())
    }

    #[zbus(property)]
    fn weather(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().weather.entries())
    }

    #[zbus(property)]
    fn calendar(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().calendar.entries())
    }

    #[zbus(property)]
    fn clipboard(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().clipboard.entries())
    }

    #[zbus(property)]
    fn home(&self) -> HashMap<String, OwnedValue> {
        dbus_map(self.config.borrow().home.entries())
    }

    async fn set(&self, table: String, key: String, value: OwnedValue) -> fdo::Result<()> {
        let value = setting_value(&value).ok_or_else(|| {
            fdo::Error::InvalidArgs(format!(
                "{table}.{key} cannot be a value of type {}",
                value.value_signature()
            ))
        })?;
        let _writing = self.writing.lock().await;
        let text = match tokio::fs::read_to_string(&self.path).await {
            Ok(text) => text,
            Err(err) if err.kind() == io::ErrorKind::NotFound => DEFAULT_CONFIG_TOML.to_owned(),
            Err(err) => {
                return Err(fdo::Error::Failed(format!(
                    "cannot read config.toml: {err}"
                )))
            }
        };
        let text = set_key(&text, &table, &key, &value)
            .map_err(|err| fdo::Error::InvalidArgs(err.to_string()))?;
        write_atomically(&self.path, &text)
            .await
            .map_err(|err| fdo::Error::Failed(format!("cannot write config.toml: {err}")))?;
        tracing::info!("set {table}.{key} = {value}");
        Ok(())
    }

    async fn reset(&self) -> fdo::Result<()> {
        let _writing = self.writing.lock().await;
        write_atomically(&self.path, DEFAULT_CONFIG_TOML)
            .await
            .map_err(|err| fdo::Error::Failed(format!("cannot write config.toml: {err}")))?;
        tracing::info!("config.toml reset to the defaults");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use zbus::zvariant::Value;

    use super::*;

    #[test]
    fn set_values_are_read_from_dbus_types() {
        assert_eq!(
            setting_value(&Value::Bool(true)),
            Some(SettingValue::Bool(true))
        );
        assert_eq!(
            setting_value(&Value::from("24h")),
            Some(SettingValue::Text("24h".into()))
        );
        for unsigned in [Value::U8(40), Value::U16(40), Value::U32(40)] {
            assert_eq!(setting_value(&unsigned), Some(SettingValue::Uint(40)));
        }
        for other in [
            Value::I16(40),
            Value::I32(40),
            Value::I64(40),
            Value::U64(40),
        ] {
            assert_eq!(setting_value(&other), Some(SettingValue::Float(40.0)));
        }
        assert_eq!(
            setting_value(&Value::I32(-3)),
            Some(SettingValue::Float(-3.0))
        );
        assert_eq!(
            setting_value(&Value::F64(0.5)),
            Some(SettingValue::Float(0.5))
        );
        assert_eq!(setting_value(&Value::new(vec![1u32])), None);
        assert_eq!(
            setting_value(&Value::new(vec!["focus", "timer"])),
            Some(SettingValue::List(vec!["focus".into(), "timer".into()]))
        );
        assert_eq!(
            setting_value(&Value::new(Vec::<String>::new())),
            Some(SettingValue::List(vec![]))
        );
    }

    #[test]
    fn published_values_keep_their_dbus_types() {
        let map = dbus_map(Config::default().appearance.entries());
        assert_eq!(map["height"].value_signature(), "u");
        assert_eq!(map["animation_speed"].value_signature(), "d");
        assert_eq!(map["background"].value_signature(), "s");
        assert_eq!(map["use_album_accent"].value_signature(), "b");
        let map = dbus_map(Config::default().home.entries());
        assert_eq!(map["tiles"].value_signature(), "as");
    }
}
