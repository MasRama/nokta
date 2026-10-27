use std::collections::HashMap;

use zbus::zvariant::{ObjectPath, OwnedValue, Str, Value};

use super::{PlaybackStatus, Selector, Track};

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
        Track::from_metadata(&map),
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
    let track = Track::from_metadata(&HashMap::new());
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
    assert_eq!(Track::from_metadata(&map), Track::default());
}

#[test]
fn artist_as_single_string() {
    let map = metadata(vec![("xesam:artist", Value::from("Daft Punk"))]);
    assert_eq!(
        Track::from_metadata(&map).artists,
        vec!["Daft Punk".to_owned()]
    );
}

#[test]
fn length_as_u64() {
    let map = metadata(vec![("mpris:length", Value::from(5_000_000u64))]);
    assert_eq!(Track::from_metadata(&map).length_us, 5_000_000);
}

#[test]
fn trackid_as_object_path() {
    let path = ObjectPath::try_from("/com/spotify/track/abc").unwrap();
    let map = metadata(vec![("mpris:trackid", Value::from(path))]);
    assert_eq!(
        Track::from_metadata(&map).track_id.as_deref(),
        Some("/com/spotify/track/abc")
    );
}

#[test]
fn identity_changes_with_title() {
    let a = Track {
        title: "A".into(),
        ..Track::default()
    };
    let b = Track {
        title: "B".into(),
        ..Track::default()
    };
    assert_ne!(a.identity(), b.identity());
    assert_eq!(a.identity(), a.clone().identity());
}

const A: &str = "org.mpris.MediaPlayer2.a";
const B: &str = "org.mpris.MediaPlayer2.b";

#[test]
fn unknown_status_is_stopped() {
    assert_eq!(
        PlaybackStatus::from_mpris("Buffering"),
        PlaybackStatus::Stopped
    );
    assert_eq!(
        PlaybackStatus::from_mpris("Playing"),
        PlaybackStatus::Playing
    );
    assert_eq!(PlaybackStatus::from_mpris("Paused"), PlaybackStatus::Paused);
    assert_eq!(PlaybackStatus::Paused.as_str(), "Paused");
}

#[test]
fn playing_beats_paused() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(A));
}

#[test]
fn most_recent_playing_wins() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Playing);
    assert_eq!(s.active(), Some(B));
    s.set_status(B, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(A));
}

#[test]
fn repeated_playing_does_not_bump_recency() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Playing);
    s.set_status(A, PlaybackStatus::Playing);
    assert_eq!(s.active(), Some(B));
}

#[test]
fn falls_back_to_last_played_paused() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Paused);
    s.set_status(A, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(A));
}

#[test]
fn paused_at_startup_is_still_selectable() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(A));
    s.set_status(B, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(B));
}

#[test]
fn stopped_only_means_none() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Stopped);
    s.set_status(B, PlaybackStatus::Stopped);
    assert_eq!(s.active(), None);
}

#[test]
fn removing_active_reselects() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Paused);
    s.set_status(B, PlaybackStatus::Playing);
    assert_eq!(s.active(), Some(B));
    s.remove(B);
    assert_eq!(s.active(), Some(A));
    s.remove(A);
    assert_eq!(s.active(), None);
}
