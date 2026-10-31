//! The files the page may ask Windows to open or show in Explorer: only
//! those the core told it about, so a page can never open a program of
//! its own choosing. Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::VecDeque;
use std::path::PathBuf;

use url::Url;

/// The downloads remembered, newest last; older ones are forgotten.
pub const KEEP: usize = 30;

/// The files the core announced.
#[derive(Debug, Default)]
pub struct KnownFiles {
    downloads: VecDeque<String>,
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

    /// The path of `uri` when the core announced it, else None.
    pub fn path(&self, uri: &str) -> Option<PathBuf> {
        if !self.downloads.iter().any(|known| known == uri) {
            return None;
        }
        Url::parse(uri).ok()?.to_file_path().ok()
    }
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
