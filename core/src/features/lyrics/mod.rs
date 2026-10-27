//! Feature `lyrics`: synced lyrics for the current track.

pub mod cache;
pub mod key;
pub mod lrc;
pub mod lrclib;

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
