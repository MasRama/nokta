//! Changes to config.toml from the settings window or the notch: one key at
//! a time, or back to the defaults. The file watcher then publishes them.

use std::io;
use std::path::PathBuf;

use tokio::sync::Mutex;

use super::edit::set_key;
use super::{SettingValue, DEFAULT_CONFIG_TOML};
use crate::shared::fs::write_atomically;

/// Why a change was not written.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WriteError {
    /// The key, the value or the file as it is now does not allow it.
    #[error("{0}")]
    Invalid(String),
    /// The file could not be read or written.
    #[error("{0}")]
    Failed(String),
}

pub struct Writer {
    path: PathBuf,
    /// One read-change-write at a time, so quick changes never lose one.
    writing: Mutex<()>,
}

impl Writer {
    pub fn new(path: PathBuf) -> Writer {
        Writer {
            path,
            writing: Mutex::new(()),
        }
    }

    /// Sets `[table] key` to `value`, keeping the rest of the file; a
    /// missing file starts from the commented default.
    pub async fn set(
        &self,
        table: &str,
        key: &str,
        value: &SettingValue,
    ) -> Result<(), WriteError> {
        let _writing = self.writing.lock().await;
        let text = match tokio::fs::read_to_string(&self.path).await {
            Ok(text) => text,
            Err(err) if err.kind() == io::ErrorKind::NotFound => DEFAULT_CONFIG_TOML.to_owned(),
            Err(err) => {
                return Err(WriteError::Failed(format!(
                    "cannot read config.toml: {err}"
                )))
            }
        };
        let text = set_key(&text, table, key, value)
            .map_err(|err| WriteError::Invalid(err.to_string()))?;
        self.write(&text).await?;
        tracing::info!("set {table}.{key} = {value}");
        Ok(())
    }

    /// Writes the commented default config over the file.
    pub async fn reset(&self) -> Result<(), WriteError> {
        let _writing = self.writing.lock().await;
        self.write(DEFAULT_CONFIG_TOML).await?;
        tracing::info!("config.toml reset to the defaults");
        Ok(())
    }

    async fn write(&self, text: &str) -> Result<(), WriteError> {
        write_atomically(&self.path, text)
            .await
            .map_err(|err| WriteError::Failed(format!("cannot write config.toml: {err}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn writer() -> (tempfile::TempDir, Writer) {
        let dir = tempfile::tempdir().unwrap();
        let writer = Writer::new(dir.path().join("config.toml"));
        (dir, writer)
    }

    #[tokio::test]
    async fn a_missing_file_starts_from_the_default() {
        let (dir, writer) = writer();
        writer
            .set("appearance", "theme", &SettingValue::Text("glass".into()))
            .await
            .unwrap();
        let text = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(text.contains("theme = \"glass\""));
        assert!(text.contains("[weather]"), "the rest of the default stays");
    }

    #[tokio::test]
    async fn a_wrong_value_is_invalid_and_changes_nothing() {
        let (dir, writer) = writer();
        writer.reset().await.unwrap();
        let err = writer
            .set("appearance", "height", &SettingValue::Text("tall".into()))
            .await
            .unwrap_err();
        assert!(matches!(err, WriteError::Invalid(_)), "{err:?}");
        let text = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert_eq!(text, DEFAULT_CONFIG_TOML);
    }

    #[tokio::test]
    async fn reset_writes_the_default() {
        let (dir, writer) = writer();
        std::fs::write(
            dir.path().join("config.toml"),
            "[appearance]\nheight = 40\n",
        )
        .unwrap();
        writer.reset().await.unwrap();
        let text = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert_eq!(text, DEFAULT_CONFIG_TOML);
    }

    #[tokio::test]
    async fn a_number_for_a_whole_key_is_written_whole() {
        let (dir, writer) = writer();
        writer
            .set("appearance", "height", &SettingValue::Float(40.0))
            .await
            .unwrap();
        let text = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(text.contains("height = 40\n") || text.contains("height = 40 "));
    }
}
