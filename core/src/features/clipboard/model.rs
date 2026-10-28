//! The clipboard history: newest first, at most `max` entries besides the
//! pinned ones. Copying the same content again moves its entry to the top.
//! Pure: the caller passes the time.

/// Text larger than this is not kept.
pub const MAX_TEXT_BYTES: usize = 1024 * 1024;
/// A PNG larger than this is not kept.
pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
/// Characters of a text preview before it is cut.
const PREVIEW_CHARS: usize = 100;

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    Text(String),
    /// A PNG.
    Image(Vec<u8>),
}

impl Content {
    /// `kind` is `text` or `image`; None for anything the history does not keep.
    pub fn new(kind: &str, text: &str, image: Vec<u8>) -> Option<Content> {
        match kind {
            "text" if !text.trim().is_empty() && text.len() <= MAX_TEXT_BYTES => {
                Some(Content::Text(text.to_owned()))
            }
            "image" if image.len() <= MAX_IMAGE_BYTES && png_size(&image).is_some() => {
                Some(Content::Image(image))
            }
            _ => None,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Content::Text(_) => "text",
            Content::Image(_) => "image",
        }
    }
}

/// The width and height in a PNG's header.
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let number =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    Some((number(16), number(20)))
}

/// A text's first line with text, spaces collapsed, cut at
/// `PREVIEW_CHARS`; a picture's size.
pub fn preview_of(content: &Content) -> String {
    match content {
        Content::Text(text) => {
            let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
            let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
            if line.chars().count() <= PREVIEW_CHARS {
                line
            } else {
                let mut cut: String = line.chars().take(PREVIEW_CHARS).collect();
                cut.push('…');
                cut
            }
        }
        Content::Image(bytes) => match png_size(bytes) {
            Some((width, height)) => format!("{width} × {height}"),
            None => String::new(),
        },
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub id: String,
    pub content: Content,
    pub preview: String,
    pub pinned: bool,
    /// When it was last copied, in microseconds since the Unix epoch.
    pub time_us: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Added {
    /// A new entry; `evicted` lists the entries that made room for it.
    New { id: String, evicted: Vec<String> },
    /// The same content was already kept; its entry moved to the top.
    Moved(String),
    /// The same content is already the newest entry.
    Unchanged,
}

#[derive(Debug)]
pub struct History {
    entries: Vec<Entry>,
    max: usize,
    next_id: u64,
}

impl History {
    pub fn new(max: usize) -> History {
        History {
            entries: Vec::new(),
            max,
            next_id: 1,
        }
    }

    /// Newest first.
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn get(&self, id: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id == id)
    }

    pub fn add(&mut self, content: Content, time_us: i64) -> Added {
        if let Some(index) = self.entries.iter().position(|e| e.content == content) {
            if index == 0 {
                return Added::Unchanged;
            }
            let mut entry = self.entries.remove(index);
            entry.time_us = time_us;
            let id = entry.id.clone();
            self.entries.insert(0, entry);
            return Added::Moved(id);
        }
        let id = self.next_id.to_string();
        self.next_id += 1;
        self.entries.insert(
            0,
            Entry {
                id: id.clone(),
                preview: preview_of(&content),
                content,
                pinned: false,
                time_us,
            },
        );
        Added::New {
            id,
            evicted: self.evict(),
        }
    }

    /// Changes the limit; returns the entries it evicted.
    pub fn set_max(&mut self, max: usize) -> Vec<String> {
        self.max = max;
        self.evict()
    }

    /// False when there is no such entry.
    pub fn pin(&mut self, id: &str, pinned: bool) -> bool {
        match self.entries.iter_mut().find(|e| e.id == id) {
            Some(entry) => {
                entry.pinned = pinned;
                true
            }
            None => false,
        }
    }

    pub fn remove(&mut self, id: &str) -> Option<Entry> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        Some(self.entries.remove(index))
    }

    /// Removes every entry that is not pinned; returns their ids.
    pub fn clear(&mut self) -> Vec<String> {
        let (pinned, gone): (Vec<_>, Vec<_>) = self.entries.drain(..).partition(|e| e.pinned);
        self.entries = pinned;
        gone.into_iter().map(|e| e.id).collect()
    }

    /// Removes every entry, pinned or not; returns their ids.
    pub fn forget_all(&mut self) -> Vec<String> {
        self.entries.drain(..).map(|e| e.id).collect()
    }

    /// The oldest unpinned entries beyond `max` go.
    fn evict(&mut self) -> Vec<String> {
        let mut evicted = Vec::new();
        while self.entries.iter().filter(|e| !e.pinned).count() > self.max {
            let Some(index) = self.entries.iter().rposition(|e| !e.pinned) else {
                break;
            };
            evicted.push(self.entries.remove(index).id);
        }
        evicted
    }
}
