//! Owns the shelf: takes commands and watches the items' folders, so a file
//! that is deleted or moved away leaves the shelf. Nothing polls. Each new
//! item's thumbnail is looked up once, off the async threads.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::{mpsc, watch};

use super::model::{path_of, Item, Shelf};
use super::thumbnails::{self, ThumbnailDirs};

/// Folder events come in bursts; the shelf looks once the burst is over.
const SETTLE: Duration = Duration::from_millis(100);

#[derive(Debug)]
pub enum Command {
    Add(Vec<String>),
    Remove(String),
    Clear,
}

/// Item URI to the path of its thumbnail; items without one are left out.
pub type Thumbnails = BTreeMap<String, String>;

/// The service's commands and its published items, oldest first.
pub struct Handle {
    pub commands: mpsc::Sender<Command>,
    pub state: watch::Receiver<Vec<Item>>,
    pub thumbnails: watch::Receiver<Thumbnails>,
}

pub fn spawn(dirs: ThumbnailDirs) -> Handle {
    let (commands, mut rx) = mpsc::channel(32);
    let (state_tx, state) = watch::channel(Vec::new());
    let (thumbs_tx, thumbnails) = watch::channel(Thumbnails::new());
    tokio::spawn(async move {
        let (fs_tx, mut fs_rx) = mpsc::unbounded_channel::<()>();
        let (found_tx, mut found_rx) = mpsc::unbounded_channel::<(String, Option<PathBuf>)>();
        let mut folders = Folders::new(fs_tx);
        let mut shelf = Shelf::default();
        // The items whose thumbnail was asked for, found or not.
        let mut asked = BTreeSet::new();
        loop {
            let changed = tokio::select! {
                command = rx.recv() => match command {
                    Some(command) => apply(&mut shelf, command),
                    None => break,
                },
                Some(()) = fs_rx.recv() => {
                    tokio::time::sleep(SETTLE).await;
                    while fs_rx.try_recv().is_ok() {}
                    shelf.retain(|i| std::fs::symlink_metadata(&i.path).is_ok())
                }
                Some((uri, found)) = found_rx.recv() => {
                    // The item may have left while its thumbnail was made.
                    if let Some(path) = found.filter(|_| asked.contains(&uri)) {
                        thumbs_tx.send_modify(|t| {
                            t.insert(uri, path.to_string_lossy().into_owned());
                        });
                    }
                    false
                }
            };
            if changed {
                folders.follow(&shelf);
                state_tx.send_replace(shelf.items().to_vec());
                let on_shelf: BTreeSet<String> =
                    shelf.items().iter().map(|i| i.uri.clone()).collect();
                asked.retain(|uri| on_shelf.contains(uri));
                thumbs_tx.send_if_modified(|t| {
                    let before = t.len();
                    t.retain(|uri, _| on_shelf.contains(uri));
                    t.len() != before
                });
                for item in shelf.items() {
                    if asked.insert(item.uri.clone()) {
                        let (dirs, found_tx, item) = (dirs.clone(), found_tx.clone(), item.clone());
                        tokio::task::spawn_blocking(move || {
                            let found = thumbnails::find(&dirs, &item.uri, &item.path);
                            let _ = found_tx.send((item.uri, found));
                        });
                    }
                }
            }
        }
    });
    Handle {
        commands,
        state,
        thumbnails,
    }
}

fn apply(shelf: &mut Shelf, command: Command) -> bool {
    match command {
        Command::Add(uris) => {
            let mut changed = false;
            for uri in uris {
                let Some(path) = path_of(&uri) else { continue };
                // Following links: a link to a folder is shown as a folder.
                let Ok(meta) = std::fs::metadata(&path) else {
                    continue;
                };
                if let Some(item) = Item::new(&uri, meta.is_dir()) {
                    changed |= shelf.add(item);
                }
            }
            changed
        }
        Command::Remove(uri) => shelf.remove(&uri),
        Command::Clear => shelf.clear(),
    }
}

/// Watches the folders that hold the items, and only those.
struct Folders {
    watcher: Option<RecommendedWatcher>,
    watched: BTreeSet<PathBuf>,
}

impl Folders {
    fn new(events: mpsc::UnboundedSender<()>) -> Folders {
        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let gone = res.is_ok_and(|e| {
                matches!(
                    e.kind,
                    EventKind::Remove(_) | EventKind::Modify(_) | EventKind::Any
                )
            });
            if gone {
                let _ = events.send(());
            }
        });
        let watcher = watcher
            .inspect_err(|e| tracing::warn!("shelf: cannot watch folders: {e}"))
            .ok();
        Folders {
            watcher,
            watched: BTreeSet::new(),
        }
    }

    fn follow(&mut self, shelf: &Shelf) {
        let Some(watcher) = self.watcher.as_mut() else {
            return;
        };
        let wanted: BTreeSet<PathBuf> = shelf
            .items()
            .iter()
            .filter_map(|i| i.path.parent().map(PathBuf::from))
            .collect();
        for dir in self.watched.difference(&wanted) {
            let _ = watcher.unwatch(dir);
        }
        let mut watched = BTreeSet::new();
        for dir in wanted {
            if self.watched.contains(&dir) {
                watched.insert(dir);
                continue;
            }
            match watcher.watch(&dir, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    watched.insert(dir);
                }
                Err(e) => tracing::warn!("shelf: cannot watch {}: {e}", dir.display()),
            }
        }
        self.watched = watched;
    }
}
