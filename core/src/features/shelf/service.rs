//! Owns the shelf: takes commands and watches the items' folders, so a file
//! that is deleted or moved away leaves the shelf. Nothing polls.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::{mpsc, watch};

use super::model::{path_of, Item, Shelf};

/// Folder events come in bursts; the shelf looks once the burst is over.
const SETTLE: Duration = Duration::from_millis(100);

#[derive(Debug)]
pub enum Command {
    Add(Vec<String>),
    Remove(String),
    Clear,
}

/// The service's commands and its published items, oldest first.
pub struct Handle {
    pub commands: mpsc::Sender<Command>,
    pub state: watch::Receiver<Vec<Item>>,
}

pub fn spawn() -> Handle {
    let (commands, mut rx) = mpsc::channel(32);
    let (state_tx, state) = watch::channel(Vec::new());
    tokio::spawn(async move {
        let (fs_tx, mut fs_rx) = mpsc::unbounded_channel::<()>();
        let mut folders = Folders::new(fs_tx);
        let mut shelf = Shelf::default();
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
            };
            if changed {
                folders.follow(&shelf);
                state_tx.send_replace(shelf.items().to_vec());
            }
        }
    });
    Handle { commands, state }
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
