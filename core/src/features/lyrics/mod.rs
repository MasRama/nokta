//! Feature `lyrics`: synced lyrics for the current track.

pub mod cache;
mod clean;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod key;
pub mod local;
pub mod lrc;
pub mod lrclib;
pub mod offsets;
pub mod service;

use serde::{Deserialize, Serialize};

/// One lyric line and the moment it starts, in microseconds from the start of the track.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Line {
    pub start_us: i64,
    pub text: String,
}

/// The outcome of looking up lyrics for a track.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "lines", rename_all = "kebab-case")]
pub enum Lookup {
    Synced(Vec<Line>),
    Plain,
    Instrumental,
    NotFound,
}

/// What `io.nokta.Lyrics1.Status` reports.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Status {
    #[default]
    None,
    Loading,
    Synced,
    Plain,
    Instrumental,
    NotFound,
    Error,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::None => "none",
            Status::Loading => "loading",
            Status::Synced => "synced",
            Status::Plain => "plain",
            Status::Instrumental => "instrumental",
            Status::NotFound => "not-found",
            Status::Error => "error",
        }
    }
}

/// Lyrics for the active track. `lines` is only filled when `status` is
/// `Synced`, and is already shifted by `offset_ms`.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct LyricsState {
    pub status: Status,
    pub lines: Vec<Line>,
    /// The user's timing for the track; positive shows the lyrics earlier.
    pub offset_ms: i64,
}

impl From<Lookup> for LyricsState {
    fn from(lookup: Lookup) -> LyricsState {
        let (status, lines) = match lookup {
            Lookup::Synced(lines) => (Status::Synced, lines),
            Lookup::Plain => (Status::Plain, Vec::new()),
            Lookup::Instrumental => (Status::Instrumental, Vec::new()),
            Lookup::NotFound => (Status::NotFound, Vec::new()),
        };
        LyricsState {
            status,
            lines,
            offset_ms: 0,
        }
    }
}
