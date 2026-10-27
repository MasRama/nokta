//! `io.nokta.Settings1` at `/io/nokta/Settings`.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use tokio::sync::{watch, Mutex};
use zbus::fdo;
use zbus::zvariant::OwnedValue;
use zbus::Connection;

use super::edit::set_key;
use super::{Config, DEFAULT_CONFIG_TOML};
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
        ("Appearance", owned(c.appearance.to_dbus())),
        ("Behavior", owned(c.behavior.to_dbus())),
        ("Lyrics", owned(c.lyrics.to_dbus())),
        ("Timer", owned(c.timer.to_dbus())),
    ]
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
        self.config.borrow().appearance.to_dbus()
    }

    #[zbus(property)]
    fn behavior(&self) -> HashMap<String, OwnedValue> {
        self.config.borrow().behavior.to_dbus()
    }

    #[zbus(property)]
    fn lyrics(&self) -> HashMap<String, OwnedValue> {
        self.config.borrow().lyrics.to_dbus()
    }

    #[zbus(property)]
    fn timer(&self) -> HashMap<String, OwnedValue> {
        self.config.borrow().timer.to_dbus()
    }

    async fn set(&self, table: String, key: String, value: OwnedValue) -> fdo::Result<()> {
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
        tracing::info!("set {table}.{key} = {}", &*value);
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
