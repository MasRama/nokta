//! Watches config.toml. The parent directory is watched so that editors that save by
//! writing a temporary file and renaming it are seen too.

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use notify::{EventKind, RecursiveMode, Watcher};
use tokio::sync::mpsc;

const DEBOUNCE: Duration = Duration::from_millis(100);

pub fn watch(path: PathBuf) -> Result<(notify::RecommendedWatcher, mpsc::Receiver<()>)> {
    let dir = path
        .parent()
        .context("config path has no parent")?
        .to_owned();
    let name: OsString = path
        .file_name()
        .context("config path has no file name")?
        .into();
    std::fs::create_dir_all(&dir)?;

    let (raw_tx, mut raw_rx) = mpsc::unbounded_channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let relevant = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        ) && event
            .paths
            .iter()
            .any(|p| p.file_name() == Some(name.as_os_str()));
        if relevant {
            let _ = raw_tx.send(());
        }
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    let (tx, rx) = mpsc::channel(1);
    tokio::spawn(async move {
        while raw_rx.recv().await.is_some() {
            tokio::time::sleep(DEBOUNCE).await;
            while raw_rx.try_recv().is_ok() {}
            if tx.send(()).await.is_err() {
                break;
            }
        }
    });
    Ok((watcher, rx))
}
