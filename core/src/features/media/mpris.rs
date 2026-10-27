//! Client-side proxies for the parts of the MPRIS spec Nokta uses
//! (<https://specifications.freedesktop.org/mpris-spec/latest/>).

use std::collections::HashMap;

use zbus::zvariant::{ObjectPath, OwnedValue, Value};

use super::Track;

pub const PATH: &str = "/org/mpris/MediaPlayer2";
pub const NAME_PREFIX: &str = "org.mpris.MediaPlayer2";
pub const PLAYER_INTERFACE: &str = "org.mpris.MediaPlayer2.Player";

#[zbus::proxy(
    interface = "org.mpris.MediaPlayer2",
    default_path = "/org/mpris/MediaPlayer2",
    gen_blocking = false
)]
pub trait Root {
    #[zbus(property)]
    fn identity(&self) -> zbus::Result<String>;
}

#[zbus::proxy(
    interface = "org.mpris.MediaPlayer2.Player",
    default_path = "/org/mpris/MediaPlayer2",
    gen_blocking = false
)]
pub trait Player {
    fn play_pause(&self) -> zbus::Result<()>;
    fn next(&self) -> zbus::Result<()>;
    fn previous(&self) -> zbus::Result<()>;
    fn set_position(&self, track_id: &ObjectPath<'_>, position: i64) -> zbus::Result<()>;

    #[zbus(signal)]
    fn seeked(&self, position: i64) -> zbus::Result<()>;

    #[zbus(property(emits_changed_signal = "false"))]
    fn position(&self) -> zbus::Result<i64>;
}

/// The track in an MPRIS `Metadata` map. Players are loose with types, so
/// every field tolerates missing or mistyped entries.
pub fn track_from_metadata(map: &HashMap<String, OwnedValue>) -> Track {
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

#[cfg(test)]
mod tests {
    use zbus::zvariant::{ObjectPath, Str};

    use super::*;

    fn owned(v: Value<'_>) -> OwnedValue {
        v.try_to_owned().unwrap()
    }

    fn metadata(entries: Vec<(&str, Value<'_>)>) -> HashMap<String, OwnedValue> {
        entries
            .into_iter()
            .map(|(k, v)| (k.to_owned(), owned(v)))
            .collect()
    }

    #[test]
    fn track_from_full_metadata() {
        let map = metadata(vec![
            (
                "mpris:trackid",
                Value::from(Str::from("/org/mpris/track/1")),
            ),
            ("xesam:title", Value::from("Get Lucky")),
            (
                "xesam:artist",
                Value::from(vec!["Daft Punk", "Pharrell Williams"]),
            ),
            ("xesam:album", Value::from("Random Access Memories")),
            ("mpris:length", Value::from(369_000_000i64)),
            ("mpris:artUrl", Value::from("file:///tmp/cover.png")),
        ]);
        assert_eq!(
            track_from_metadata(&map),
            Track {
                track_id: Some("/org/mpris/track/1".into()),
                title: "Get Lucky".into(),
                artists: vec!["Daft Punk".into(), "Pharrell Williams".into()],
                album: "Random Access Memories".into(),
                length_us: 369_000_000,
                art_url: Some("file:///tmp/cover.png".into()),
            }
        );
    }

    #[test]
    fn track_from_empty_metadata() {
        let track = track_from_metadata(&HashMap::new());
        assert_eq!(track, Track::default());
        assert_eq!(track.length_us, 0);
        assert!(track.title.is_empty() && track.artists.is_empty() && track.art_url.is_none());
    }

    #[test]
    fn wrong_types_are_ignored() {
        let map = metadata(vec![
            ("xesam:title", Value::from(7u32)),
            ("mpris:length", Value::from("long")),
            ("mpris:artUrl", Value::from("")),
        ]);
        assert_eq!(track_from_metadata(&map), Track::default());
    }

    #[test]
    fn artist_as_single_string() {
        let map = metadata(vec![("xesam:artist", Value::from("Daft Punk"))]);
        assert_eq!(
            track_from_metadata(&map).artists,
            vec!["Daft Punk".to_owned()]
        );
    }

    #[test]
    fn length_as_u64() {
        let map = metadata(vec![("mpris:length", Value::from(5_000_000u64))]);
        assert_eq!(track_from_metadata(&map).length_us, 5_000_000);
    }

    #[test]
    fn trackid_as_object_path() {
        let path = ObjectPath::try_from("/com/spotify/track/abc").unwrap();
        let map = metadata(vec![("mpris:trackid", Value::from(path))]);
        assert_eq!(
            track_from_metadata(&map).track_id.as_deref(),
            Some("/com/spotify/track/abc")
        );
    }
}
