//! The files the page may ask Windows to open, show in Explorer or drag
//! out: only those the core told it about, the downloads and the shelf's,
//! so a page can never open a program of its own choosing. And the URIs
//! of files dropped on the notch. Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use url::Url;

/// The downloads remembered, newest last; older ones are forgotten.
pub const KEEP: usize = 30;

/// The files the core announced.
#[derive(Debug, Default)]
pub struct KnownFiles {
    downloads: VecDeque<String>,
    shelf: Vec<String>,
}

impl KnownFiles {
    /// A download finished.
    pub fn add_download(&mut self, uri: &str) {
        self.downloads.retain(|known| known != uri);
        self.downloads.push_back(uri.to_owned());
        while self.downloads.len() > KEEP {
            self.downloads.pop_front();
        }
    }

    /// The shelf's items now.
    pub fn set_shelf(&mut self, uris: Vec<String>) {
        self.shelf = uris;
    }

    /// The path of `uri` when the core announced it, else None.
    pub fn path(&self, uri: &str) -> Option<PathBuf> {
        if !self
            .downloads
            .iter()
            .chain(&self.shelf)
            .any(|known| known == uri)
        {
            return None;
        }
        Url::parse(uri).ok()?.to_file_path().ok()
    }
}

/// The file URIs of dropped paths; a path that is not absolute is left out.
pub fn uris(paths: &[impl AsRef<Path>]) -> Vec<String> {
    paths
        .iter()
        .filter_map(|path| Url::from_file_path(path).ok())
        .map(String::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A file URI on this system.
    fn uri(name: &str) -> String {
        let path = std::env::temp_dir().join(name);
        Url::from_file_path(&path).unwrap().to_string()
    }

    #[test]
    fn opens_only_what_the_core_announced() {
        let mut known = KnownFiles::default();
        let report = uri("report.pdf");
        assert_eq!(known.path(&report), None);
        known.add_download(&report);
        assert_eq!(
            known.path(&report),
            Some(std::env::temp_dir().join("report.pdf"))
        );
        assert_eq!(known.path(&uri("other.exe")), None);
        assert_eq!(known.path("https://example.com/x.exe"), None);
    }

    #[test]
    fn opens_what_is_on_the_shelf_while_it_is_there() {
        let mut known = KnownFiles::default();
        let notes = uri("notes.txt");
        known.set_shelf(vec![notes.clone()]);
        assert!(known.path(&notes).is_some());
        known.set_shelf(Vec::new());
        assert_eq!(known.path(&notes), None);
    }

    #[test]
    fn dropped_paths_become_file_uris() {
        let path = std::env::temp_dir().join("a b.txt");
        assert_eq!(uris(&[&path]), vec![uri("a b.txt")]);
        assert!(uris(&[&path])[0].starts_with("file:///"));
        assert!(uris(&["relative.txt"]).is_empty());
    }

    #[test]
    fn a_web_address_is_never_a_file() {
        let mut known = KnownFiles::default();
        known.add_download("https://example.com/x.exe");
        assert_eq!(known.path("https://example.com/x.exe"), None);
    }

    #[test]
    fn forgets_the_oldest_downloads() {
        let mut known = KnownFiles::default();
        let first = uri("0.zip");
        known.add_download(&first);
        for i in 1..=KEEP {
            known.add_download(&uri(&format!("{i}.zip")));
        }
        assert_eq!(known.path(&first), None);
        assert!(known.path(&uri("1.zip")).is_some());
    }

    #[test]
    fn the_same_download_again_counts_as_new() {
        let mut known = KnownFiles::default();
        let first = uri("0.zip");
        known.add_download(&first);
        for i in 1..KEEP {
            known.add_download(&uri(&format!("{i}.zip")));
        }
        known.add_download(&first);
        known.add_download(&uri("new.zip"));
        assert!(known.path(&first).is_some());
    }
}
