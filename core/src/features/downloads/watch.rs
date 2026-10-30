//! Watches the download folder, not its subfolders, and passes on what
//! happens to its files.

use std::path::{Path, PathBuf};

use notify::event::{AccessKind, AccessMode, ModifyKind, RenameMode};
use notify::{Event, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use super::model::EventKind;

/// Watches `dir` and sends what happens to the files in it to `events`.
pub fn watch(
    dir: &Path,
    events: mpsc::UnboundedSender<(PathBuf, EventKind)>,
) -> notify::Result<notify::RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            for item in kinds(&event) {
                let _ = events.send(item);
            }
        }
    })?;
    watcher.watch(dir, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

/// What one event from `notify` means for each of its paths.
pub fn kinds(event: &Event) -> Vec<(PathBuf, EventKind)> {
    use notify::EventKind as Raw;
    let all = |kind: EventKind| event.paths.iter().map(|p| (p.clone(), kind)).collect();
    match event.kind {
        Raw::Modify(ModifyKind::Name(RenameMode::Both)) => match event.paths.as_slice() {
            [from, to] => vec![
                (from.clone(), EventKind::Removed),
                (to.clone(), EventKind::RenamedTo),
            ],
            _ => Vec::new(),
        },
        Raw::Modify(ModifyKind::Name(RenameMode::From)) | Raw::Remove(_) => all(EventKind::Removed),
        // Other systems may not say which end of a rename this is; a path
        // that is gone has no size and is dropped when it settles.
        Raw::Modify(ModifyKind::Name(_)) => all(EventKind::RenamedTo),
        Raw::Access(AccessKind::Close(AccessMode::Write)) => all(EventKind::ClosedWrite),
        // Only inotify tells when a file is closed; elsewhere a new file
        // counts, and settles once nothing touches it.
        Raw::Create(_) | Raw::Modify(ModifyKind::Data(_) | ModifyKind::Any)
            if !cfg!(target_os = "linux") =>
        {
            all(EventKind::ClosedWrite)
        }
        _ => Vec::new(),
    }
}
