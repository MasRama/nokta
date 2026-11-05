//! Hears a plugin folder being added, removed or its `plugin.toml`
//! changing, and `plugins.toml` being edited, so a plugin being written
//! by hand shows up without restarting Nokta.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Result;
use notify::{EventKind, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use super::manifest;

const DEBOUNCE: Duration = Duration::from_millis(300);

/// Whether a change at `path` matters: the saved file, a plugin's manifest,
/// or a folder right in `plugins_dir`.
pub fn relevant(path: &Path, plugins_dir: &Path, saved_file: &Path) -> bool {
    path == saved_file
        || path.file_name().is_some_and(|n| n == manifest::FILE)
        || path.parent() == Some(plugins_dir)
}

pub fn watch(
    plugins_dir: PathBuf,
    saved_file: PathBuf,
) -> Result<(notify::RecommendedWatcher, mpsc::Receiver<()>)> {
    std::fs::create_dir_all(&plugins_dir)?;
    let saved_dir = saved_file.parent().map(Path::to_owned).unwrap_or_default();
    std::fs::create_dir_all(&saved_dir)?;
    let (raw_tx, mut raw_rx) = mpsc::unbounded_channel::<()>();
    let (dir, file) = (plugins_dir.clone(), saved_file.clone());
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let kind = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        );
        if kind && event.paths.iter().any(|p| relevant(p, &dir, &file)) {
            let _ = raw_tx.send(());
        }
    })?;
    watcher.watch(&plugins_dir, RecursiveMode::Recursive)?;
    watcher.watch(&saved_dir, RecursiveMode::NonRecursive)?;
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
