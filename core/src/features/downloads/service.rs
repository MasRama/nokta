//! Follows `[downloads]`, watches the folder it names and sends each file
//! that finishes, with its icon and a thumbnail for a picture.

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, watch};
use url::Url;

use super::model::{EventKind, Model};
use crate::features::settings::DownloadsConfig;
use crate::shared::fs::icon_for;
use crate::shared::picture::write_file_thumbnail;

/// Thumbnails kept in the cache; older ones are deleted.
pub const KEEP_THUMBNAILS: usize = 20;

/// A file that finished downloading, as `io.nokta.Downloads1.Finished` sends it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finished {
    pub uri: String,
    pub name: String,
    pub icon: String,
    pub size: u64,
    /// A PNG of a picture, empty for other files.
    pub thumbnail: String,
}

/// Watches the folder `[downloads]` names, else `default_dir`, while it is
/// on. Thumbnails go to `thumbnails`.
pub fn spawn(
    mut config: watch::Receiver<DownloadsConfig>,
    default_dir: Option<PathBuf>,
    thumbnails: PathBuf,
) -> mpsc::Receiver<Finished> {
    let (tx, rx) = mpsc::channel(8);
    tokio::spawn(async move {
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let mut model = Model::default();
        let mut watcher = start(&config.borrow_and_update(), &default_dir, &events_tx);
        loop {
            let deadline = model.next_deadline();
            let settle = async {
                match deadline {
                    Some(at) => tokio::time::sleep_until(at.into()).await,
                    None => std::future::pending().await,
                }
            };
            tokio::select! {
                changed = config.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    // The old watcher stops before the new one starts.
                    drop(watcher.take());
                    model = Model::default();
                    watcher = start(&config.borrow_and_update(), &default_dir, &events_tx);
                }
                Some((path, kind)) = events.recv() => {
                    if watcher.is_some() {
                        model.event(path, kind, Instant::now());
                    }
                }
                () = settle => {
                    for path in model.due(Instant::now(), file_size) {
                        let thumbnails = thumbnails.clone();
                        let made = tokio::task::spawn_blocking(move || finished(&path, &thumbnails));
                        if let Ok(Some(file)) = made.await {
                            tracing::debug!(?file, "download finished");
                            if tx.send(file).await.is_err() {
                                return;
                            }
                        }
                    }
                }
            }
        }
    });
    rx
}

/// Starts watching the configured folder, or nothing when it is off or
/// missing.
fn start(
    config: &DownloadsConfig,
    default_dir: &Option<PathBuf>,
    events: &mpsc::UnboundedSender<(PathBuf, EventKind)>,
) -> Option<notify::RecommendedWatcher> {
    if !config.enabled {
        return None;
    }
    let dir = match config.folder.as_str() {
        "" => default_dir.clone()?,
        folder => PathBuf::from(folder),
    };
    match super::watch::watch(&dir, events.clone()) {
        Ok(watcher) => Some(watcher),
        Err(err) => {
            tracing::warn!("not watching downloads in {}: {err}", dir.display());
            None
        }
    }
}

/// The size of a plain file; none for a folder or a file that is gone.
fn file_size(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .filter(|m| m.is_file())
        .map(|m| m.len())
}

/// What the notch shows of the file at `path`. Blocks while it makes a
/// thumbnail.
fn finished(path: &Path, thumbnails: &Path) -> Option<Finished> {
    let meta = std::fs::metadata(path).ok()?;
    let uri = Url::from_file_path(path).ok()?.to_string();
    let changed = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    // Named after the file and its version, so a new download of the same
    // name never shows an old picture the shell has cached.
    let key = format!("{uri}\n{}\n{changed:?}", meta.len());
    let dest = thumbnails.join(format!("{}.png", hex::encode(Sha256::digest(key))));
    let thumbnail = match write_file_thumbnail(path, &dest) {
        Ok(true) => {
            prune(thumbnails, KEEP_THUMBNAILS);
            dest.display().to_string()
        }
        Ok(false) => String::new(),
        Err(err) => {
            tracing::debug!("downloads: no thumbnail for {}: {err:#}", path.display());
            String::new()
        }
    };
    Some(Finished {
        uri,
        name: path.file_name()?.to_string_lossy().into_owned(),
        icon: icon_for(path, false).to_owned(),
        size: meta.len(),
        thumbnail,
    })
}

/// Deletes all but the `keep` newest files in `dir`.
pub fn prune(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort_by_key(|(changed, _)| std::cmp::Reverse(*changed));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}
