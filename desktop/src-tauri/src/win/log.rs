//! The log: `%LOCALAPPDATA%\nokta\nokta.log`, started again on each run, at
//! `NOKTA_LOG` (default info). A friend testing Nokta can send it along.

use std::fs::File;
use std::sync::Mutex;

use nokta_core::shared::paths::Paths;
use tracing_subscriber::EnvFilter;

pub fn init(paths: &Paths) {
    let Some(dir) = paths.cache_dir.parent() else {
        return;
    };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let Ok(file) = File::create(dir.join("nokta.log")) else {
        return;
    };
    let filter = EnvFilter::try_from_env("NOKTA_LOG").unwrap_or_else(|_| "info".into());
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(Mutex::new(file))
        .with_ansi(false)
        .try_init();
}
