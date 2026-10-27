use std::collections::HashMap;

use zbus::zvariant::{OwnedValue, Value};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PlaybackStatus {
    Playing,
    Paused,
    #[default]
    Stopped,
}

impl PlaybackStatus {
    /// Maps an MPRIS `PlaybackStatus` string; anything unknown counts as stopped.
    pub fn from_mpris(s: &str) -> PlaybackStatus {
        match s {
            "Playing" => PlaybackStatus::Playing,
            "Paused" => PlaybackStatus::Paused,
            _ => PlaybackStatus::Stopped,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            PlaybackStatus::Playing => "Playing",
            PlaybackStatus::Paused => "Paused",
            PlaybackStatus::Stopped => "Stopped",
        }
    }
}

/// The parts of MPRIS `Metadata` Nokta uses. Players are loose with types,
/// so every field tolerates missing or mistyped entries.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Track {
    pub track_id: Option<String>,
    pub title: String,
    pub artists: Vec<String>,
    pub album: String,
    pub length_us: i64,
    pub art_url: Option<String>,
}

impl Track {
    pub fn from_metadata(map: &HashMap<String, OwnedValue>) -> Track {
        let get = |key: &str| map.get(key).map(|v| unwrap_variant(v));
        let string = |key: &str| get(key).and_then(as_string);
        Track {
            track_id: string("mpris:trackid").filter(|s| !s.is_empty()),
            title: string("xesam:title").unwrap_or_default(),
            artists: get("xesam:artist").map(as_strings).unwrap_or_default(),
            album: string("xesam:album").unwrap_or_default(),
            length_us: get("mpris:length").and_then(as_i64).unwrap_or(0).max(0),
            art_url: string("mpris:artUrl").filter(|s| !s.is_empty()),
        }
    }

    /// What distinguishes one track from the next.
    pub fn identity(&self) -> (Option<&str>, &str, &[String]) {
        (self.track_id.as_deref(), &self.title, &self.artists)
    }
}

fn unwrap_variant<'a>(mut v: &'a Value<'a>) -> &'a Value<'a> {
    while let Value::Value(inner) = v {
        v = inner;
    }
    v
}

fn as_string(v: &Value<'_>) -> Option<String> {
    match v {
        Value::Str(s) => Some(s.to_string()),
        Value::ObjectPath(p) => Some(p.as_str().to_owned()),
        _ => None,
    }
}

fn as_strings(v: &Value<'_>) -> Vec<String> {
    match v {
        Value::Array(items) => items
            .iter()
            .filter_map(|i| as_string(unwrap_variant(i)))
            .collect(),
        other => as_string(other).into_iter().collect(),
    }
}

fn as_i64(v: &Value<'_>) -> Option<i64> {
    match *v {
        Value::I64(n) => Some(n),
        Value::U64(n) => i64::try_from(n).ok(),
        Value::I32(n) => Some(n.into()),
        Value::U32(n) => Some(n.into()),
        _ => None,
    }
}
