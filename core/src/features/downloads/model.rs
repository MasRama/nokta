//! Which files in the download folder have finished: a file renamed into
//! place or closed after writing, once nothing has touched it for a moment.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// How long a file goes untouched before it counts as finished.
pub const SETTLE: Duration = Duration::from_millis(1500);
/// A file reported once is not reported again for this long.
pub const REPEAT: Duration = Duration::from_secs(60);

/// What browsers and download tools name a file while it is still coming in.
const TEMPORARY: [&str; 6] = [
    ".part",
    ".crdownload",
    ".download",
    ".partial",
    ".tmp",
    ".opdownload",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    /// Renamed to this path, as a browser does with a finished `.part`.
    RenamedTo,
    /// Closed after it was written.
    ClosedWrite,
    /// Deleted or renamed away.
    Removed,
}

#[derive(Debug, Default)]
pub struct Model {
    /// Candidates and when each settles.
    pending: HashMap<PathBuf, Instant>,
    /// Files reported, and when.
    reported: HashMap<PathBuf, Instant>,
}

impl Model {
    pub fn event(&mut self, path: PathBuf, kind: EventKind, now: Instant) {
        if kind == EventKind::Removed {
            self.pending.remove(&path);
        } else if is_candidate(&path) {
            self.pending.insert(path, now + SETTLE);
        }
    }

    /// The files that settled by `now`, in name order. `size` reads a
    /// file's size, `None` for a folder or a file that is gone.
    pub fn due(&mut self, now: Instant, size: impl Fn(&Path) -> Option<u64>) -> Vec<PathBuf> {
        self.reported.retain(|_, at| now < *at + REPEAT);
        let mut settled: Vec<PathBuf> = self
            .pending
            .iter()
            .filter(|(_, deadline)| **deadline <= now)
            .map(|(path, _)| path.clone())
            .collect();
        settled.sort();
        settled.retain(|path| {
            self.pending.remove(path);
            let fresh = !self.reported.contains_key(path) && size(path).is_some_and(|n| n > 0);
            if fresh {
                self.reported.insert(path.clone(), now);
            }
            fresh
        });
        settled
    }

    /// When the next candidate settles.
    pub fn next_deadline(&self) -> Option<Instant> {
        self.pending.values().min().copied()
    }
}

/// Not hidden and not named like a download in progress.
fn is_candidate(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let lower = name.to_lowercase();
    !name.starts_with('.')
        && !name.ends_with('~')
        && !TEMPORARY.iter().any(|suffix| lower.ends_with(suffix))
}
