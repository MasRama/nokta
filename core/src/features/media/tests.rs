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

#[test]
fn a_chosen_paused_player_wins_over_a_playing_one() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Paused);
    assert!(s.select(B));
    assert_eq!(s.active(), Some(B));
    // Its own pause and play keep it chosen.
    s.set_status(B, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(B));
}

#[test]
fn a_chosen_player_gives_way_when_another_starts_playing() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Paused);
    s.set_status(B, PlaybackStatus::Playing);
    s.select(A);
    // Playing since before the choice does not count.
    s.set_status(B, PlaybackStatus::Playing);
    assert_eq!(s.active(), Some(A));
    s.set_status(B, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(A));
    s.set_status(B, PlaybackStatus::Playing);
    assert_eq!(s.active(), Some(B));
}

#[test]
fn a_chosen_player_gives_way_when_it_stops_or_leaves() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Paused);
    s.select(B);
    s.set_status(B, PlaybackStatus::Stopped);
    assert_eq!(s.active(), Some(A));
    s.set_status(B, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(A));

    s.select(B);
    s.remove(B);
    s.set_status(B, PlaybackStatus::Paused);
    assert_eq!(s.active(), Some(A));
}

#[test]
fn only_known_running_players_can_be_chosen() {
    let mut s = Selector::default();
    s.set_status(A, PlaybackStatus::Playing);
    s.set_status(B, PlaybackStatus::Stopped);
    assert!(!s.select(B));
    assert!(!s.select(":1.99"));
    assert_eq!(s.active(), Some(A));
}

#[test]
fn players_are_listed_in_the_order_they_appeared() {
    let mut s = Selector::default();
    s.set_status(B, PlaybackStatus::Paused);
    s.set_status(A, PlaybackStatus::Playing);
    s.set_status(":1.3", PlaybackStatus::Stopped);
    s.set_status(B, PlaybackStatus::Playing);
    assert_eq!(s.players(), vec![B, A]);
    s.remove(B);
    s.set_status(B, PlaybackStatus::Paused);
    assert_eq!(s.players(), vec![A, B]);
}
