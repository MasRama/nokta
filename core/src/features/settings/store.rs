//! The current config, kept valid across bad edits.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::config::{parse, Config, ConfigError, DEFAULT_CONFIG_TOML};

pub struct Store {
    path: PathBuf,
    current: Config,
}

impl Store {
    /// Loads the config, writing the commented default file when none exists.
    /// An invalid file is logged and left untouched; the defaults are used instead.
    pub fn load_or_init(path: &Path) -> Store {
        let mut store = Store {
            path: path.to_owned(),
            current: Config::default(),
        };
        if path.exists() {
            if let Err(err) = store.reload() {
                tracing::error!("{}: {err}; using defaults", path.display());
            }
        } else if let Err(err) = write_default(path) {
            tracing::warn!("cannot write {}: {err}", path.display());
        }
        store
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn current(&self) -> &Config {
        &self.current
    }

    /// Re-reads the file. Returns whether the config changed. On error the last valid
    /// config stays current; a missing file also keeps it.
    pub fn reload(&mut self) -> Result<bool, ConfigError> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(err) => {
                return Err(ConfigError {
                    message: format!("cannot read file: {err}"),
                    line: None,
                    column: None,
                })
            }
        };
        let config = parse(&text)?;
        let changed = config != self.current;
        self.current = config;
        Ok(changed)
    }
}

fn write_default(path: &Path) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(path, DEFAULT_CONFIG_TOML)
}
