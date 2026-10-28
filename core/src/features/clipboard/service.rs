//! Owns the clipboard history. The extension hands in each copy; a picture's
//! thumbnail is written off the async threads to a private folder and
//! deleted with its entry. Nothing is written for text.

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::ImageReader;
use tokio::sync::{mpsc, oneshot, watch};

use super::model::{Added, Content, History};
use crate::features::settings::ClipboardConfig;
use crate::shared::picture::write_thumbnail;

#[derive(Debug)]
pub enum Command {
    Add(Content),
    Get(String, oneshot::Sender<Option<Content>>),
    Pin(String, bool),
    Remove(String),
    /// Removes every entry that is not pinned.
    Clear,
    SetPaused(bool),
}

/// One entry as io.nokta.Clipboard1.Items lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub id: String,
    /// `text` or `image`.
    pub kind: &'static str,
    pub preview: String,
    /// A PNG path, or empty while there is none.
    pub thumbnail: String,
    pub pinned: bool,
    pub time_us: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Published {
    /// Newest first.
    pub items: Vec<Row>,
    pub paused: bool,
}

pub struct Handle {
    pub commands: mpsc::Sender<Command>,
    pub state: watch::Receiver<Published>,
}

/// `dir` holds the thumbnails and is emptied first; `now` gives the wall
/// clock in microseconds since the Unix epoch.
pub fn spawn(
    mut config: watch::Receiver<ClipboardConfig>,
    dir: PathBuf,
    now: impl Fn() -> i64 + Send + 'static,
) -> Handle {
    let (commands, mut rx) = mpsc::channel(32);
    let (state_tx, state) = watch::channel(Published::default());
    tokio::spawn(async move {
        let cleared = dir.clone();
        let _ = tokio::task::spawn_blocking(move || prepare(&cleared)).await;
        let (made_tx, mut made_rx) = mpsc::unbounded_channel::<(String, PathBuf)>();
        let mut settings = config.borrow_and_update().clone();
        let mut history = History::new(settings.max_items as usize);
        let mut thumbnails: BTreeMap<String, PathBuf> = BTreeMap::new();
        let mut paused = false;
        loop {
            // A config change applies before the commands sent after it.
            let gone = tokio::select! {
                biased;
                Ok(()) = config.changed() => {
                    settings = config.borrow_and_update().clone();
                    if settings.enabled {
                        history.set_max(settings.max_items as usize)
                    } else {
                        history.forget_all()
                    }
                }
                command = rx.recv() => match command {
                    Some(Command::Add(content)) if settings.enabled && !paused => {
                        let picture = match &content {
                            Content::Image(bytes) => Some(bytes.clone()),
                            Content::Text(_) => None,
                        };
                        match history.add(content, now()) {
                            Added::New { id, evicted } => {
                                if let Some(bytes) = picture {
                                    spawn_thumbnail(&dir, id, bytes, made_tx.clone());
                                }
                                evicted
                            }
                            Added::Moved(_) => Vec::new(),
                            Added::Unchanged => continue,
                        }
                    }
                    Some(Command::Add(_)) => continue,
                    Some(Command::Get(id, reply)) => {
                        let _ = reply.send(history.get(&id).map(|e| e.content.clone()));
                        continue;
                    }
                    Some(Command::Pin(id, pinned)) => {
                        if !history.pin(&id, pinned) {
                            continue;
                        }
                        Vec::new()
                    }
                    Some(Command::Remove(id)) => match history.remove(&id) {
                        Some(entry) => vec![entry.id],
                        None => continue,
                    },
                    Some(Command::Clear) => history.clear(),
                    Some(Command::SetPaused(on)) => {
                        paused = on;
                        Vec::new()
                    }
                    None => break,
                },
                Some((id, path)) = made_rx.recv() => {
                    // The entry may have gone while its thumbnail was made.
                    if history.get(&id).is_some() {
                        thumbnails.insert(id, path);
                        Vec::new()
                    } else {
                        vec![id]
                    }
                }
            };
            delete_thumbnails(&dir, &mut thumbnails, gone);
            state_tx.send_if_modified(|published| {
                let next = Published {
                    items: rows(&history, &thumbnails),
                    paused,
                };
                let changed = *published != next;
                *published = next;
                changed
            });
        }
    });
    Handle { commands, state }
}

fn rows(history: &History, thumbnails: &BTreeMap<String, PathBuf>) -> Vec<Row> {
    history
        .entries()
        .iter()
        .map(|e| Row {
            id: e.id.clone(),
            kind: e.content.kind(),
            preview: e.preview.clone(),
            thumbnail: thumbnails
                .get(&e.id)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            pinned: e.pinned,
            time_us: e.time_us,
        })
        .collect()
}

fn thumbnail_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.png"))
}

/// Empties the folder left from the last run and keeps it to this user.
fn prepare(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
    match std::fs::create_dir_all(dir) {
        Err(e) => tracing::warn!("clipboard: cannot create {}: {e}", dir.display()),
        #[cfg(unix)]
        Ok(()) => {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
        #[cfg(not(unix))]
        Ok(()) => {}
    }
}

fn spawn_thumbnail(
    dir: &Path,
    id: String,
    png: Vec<u8>,
    made: mpsc::UnboundedSender<(String, PathBuf)>,
) {
    let dest = thumbnail_path(dir, &id);
    tokio::task::spawn_blocking(move || {
        match write_thumbnail(ImageReader::new(Cursor::new(png)), &dest) {
            Ok(()) => {
                let _ = made.send((id, dest));
            }
            Err(e) => tracing::debug!("clipboard: no thumbnail for entry {id}: {e:#}"),
        }
    });
}

fn delete_thumbnails(dir: &Path, thumbnails: &mut BTreeMap<String, PathBuf>, ids: Vec<String>) {
    let paths: Vec<PathBuf> = ids
        .into_iter()
        .map(|id| {
            thumbnails
                .remove(&id)
                .unwrap_or_else(|| thumbnail_path(dir, &id))
        })
        .collect();
    if paths.is_empty() {
        return;
    }
    tokio::task::spawn_blocking(move || {
        for path in paths {
            let _ = std::fs::remove_file(path);
        }
    });
}
