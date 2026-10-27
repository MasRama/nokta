use super::{PlaybackStatus, Selector, Track};

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
