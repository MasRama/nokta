//! The shelf's items. Pure: the service checks the file system.

use std::path::{Path, PathBuf};

use url::Url;

/// The shelf drops its oldest item to make room past this many.
pub const MAX_ITEMS: usize = 30;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    /// The file's URI, written the same way whatever form it came in.
    pub uri: String,
    pub path: PathBuf,
    pub name: String,
    /// An icon name from the icon theme.
    pub icon: &'static str,
}

impl Item {
    /// The item for a local `file://` URI, or `None` for any other URI.
    pub fn new(uri: &str, is_dir: bool) -> Option<Item> {
        let path = path_of(uri)?;
        let uri = Url::from_file_path(&path).ok()?.to_string();
        let name = match path.file_name() {
            Some(name) => name.to_string_lossy().into_owned(),
            None => path.display().to_string(),
        };
        let icon = icon_for(&path, is_dir);
        Some(Item {
            uri,
            path,
            name,
            icon,
        })
    }
}

/// The path of a local `file://` URI (no host, or `localhost`).
pub fn path_of(uri: &str) -> Option<PathBuf> {
    // The URL parser reads "file:name" as "file:///name"; that is not a file
    // anyone dropped.
    if !uri.starts_with("file://") {
        return None;
    }
    let url = Url::parse(uri).ok()?;
    if url
        .host_str()
        .is_some_and(|h| !h.is_empty() && h != "localhost")
    {
        return None;
    }
    url.to_file_path().ok()
}

/// The icon for a file from its extension; folders get "folder".
pub fn icon_for(path: &Path, is_dir: bool) -> &'static str {
    if is_dir {
        return "folder";
    }
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "tif" | "tiff" | "heic"
        | "avif" | "ico" => "image-x-generic",
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "m4v" | "mpg" | "mpeg" => "video-x-generic",
        "mp3" | "flac" | "ogg" | "opus" | "wav" | "m4a" | "aac" => "audio-x-generic",
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "epub" => "x-office-document",
        "xls" | "xlsx" | "ods" | "csv" => "x-office-spreadsheet",
        "ppt" | "pptx" | "odp" => "x-office-presentation",
        "zip" | "tar" | "gz" | "tgz" | "xz" | "bz2" | "zst" | "7z" | "rar" | "deb" | "rpm" => {
            "package-x-generic"
        }
        "txt" | "md" | "log" | "json" | "toml" | "yaml" | "yml" | "xml" | "html" | "css" | "js"
        | "ts" | "rs" | "py" | "sh" | "c" | "h" | "cpp" | "go" | "java" => "text-x-generic",
        _ => "application-x-generic",
    }
}

/// The parked items, oldest first.
#[derive(Debug, Default)]
pub struct Shelf {
    items: Vec<Item>,
}

impl Shelf {
    pub fn items(&self) -> &[Item] {
        &self.items
    }

    /// Adds `item` unless its file is already here; false when skipped.
    pub fn add(&mut self, item: Item) -> bool {
        if self.items.iter().any(|i| i.path == item.path) {
            return false;
        }
        if self.items.len() == MAX_ITEMS {
            self.items.remove(0);
        }
        self.items.push(item);
        true
    }

    /// Takes off the item for `uri`; false when it was not here.
    pub fn remove(&mut self, uri: &str) -> bool {
        let Some(path) = path_of(uri) else {
            return false;
        };
        self.retain(|i| i.path != path)
    }

    pub fn clear(&mut self) -> bool {
        let changed = !self.items.is_empty();
        self.items.clear();
        changed
    }

    /// Keeps only the items `keep` accepts; true when any left.
    pub fn retain(&mut self, keep: impl FnMut(&Item) -> bool) -> bool {
        let before = self.items.len();
        self.items.retain(keep);
        self.items.len() != before
    }
}
