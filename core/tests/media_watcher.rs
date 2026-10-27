#![cfg(target_os = "linux")]

mod support;

use std::time::Duration;

use nokta_core::features::media::{art::ArtCache, watcher, PlaybackStatus};
use support::bus::TestBus;
use support::fake_player::{Caps, FakePlayer, Meta};
use support::wait_for;

async fn start_watcher(
    bus: &TestBus,
    cache: &tempfile::TempDir,
) -> (
    tokio::sync::watch::Receiver<nokta_core::features::media::MediaState>,
    nokta_core::features::media::control::Controller,
) {
    let art = ArtCache::new(cache.path().to_owned(), reqwest::Client::new());
    watcher::spawn(bus.connect().await, art)
}

#[tokio::test]
async fn picks_up_existing_player() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let _a = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let (mut rx, _ctl) = start_watcher(&bus, &cache).await;
    let s = wait_for(&mut rx, "existing player", |s| s.available).await;
    assert_eq!(s.player_name, "Fake a");
    assert_eq!(s.status, PlaybackStatus::Playing);
    assert_eq!(s.track.title, "Song 1");
    assert_eq!(s.track.length_us, 200_000_000);
    assert_eq!(s.rate, 1.0);
    assert!(s.can_seek && s.can_go_next && s.can_go_previous && s.can_play_pause);
    assert!(s.position_timestamp_us > 0);
}

#[tokio::test]
async fn follows_new_player_and_status_changes() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let (mut rx, _ctl) = start_watcher(&bus, &cache).await;
    assert!(!rx.borrow().available);

    let a = FakePlayer::start(bus.address(), "a", "Paused", Meta::new(1)).await;
    wait_for(&mut rx, "player a", |s| s.player_name == "Fake a").await;

    let b = FakePlayer::start(bus.address(), "b", "Playing", Meta::new(2)).await;
    wait_for(&mut rx, "playing b wins", |s| s.player_name == "Fake b").await;

    a.set_status("Playing").await;
    wait_for(&mut rx, "a played most recently", |s| {
        s.player_name == "Fake a"
    })
    .await;

    a.set_meta(Meta::new(3)).await;
    wait_for(&mut rx, "a's new track", |s| s.track.title == "Song 3").await;

    a.set_status("Paused").await;
    wait_for(&mut rx, "b is the only one playing", |s| {
        s.player_name == "Fake b"
    })
    .await;
    drop(b);
}

#[tokio::test]
async fn vanished_player_clears_state() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let a = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let (mut rx, _ctl) = start_watcher(&bus, &cache).await;
    wait_for(&mut rx, "player a", |s| s.available).await;
    a.vanish().await;
    let s = wait_for(&mut rx, "no player", |s| !s.available).await;
    assert_eq!(s, Default::default());
}

#[tokio::test]
async fn seeked_refreshes_snapshot() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let a = FakePlayer::start(bus.address(), "a", "Paused", Meta::new(1)).await;
    let (mut rx, _ctl) = start_watcher(&bus, &cache).await;
    let before = wait_for(&mut rx, "player a", |s| s.available).await;
    assert_eq!(before.position_us, 0);
    a.seek(42_000_000).await;
    let after = wait_for(&mut rx, "seek", |s| s.position_us == 42_000_000).await;
    assert!(after.position_timestamp_us >= before.position_timestamp_us);
}

#[tokio::test]
async fn refresh_position_reads_player() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let a = FakePlayer::start(bus.address(), "a", "Paused", Meta::new(1)).await;
    let (mut rx, ctl) = start_watcher(&bus, &cache).await;
    wait_for(&mut rx, "player a", |s| s.available).await;
    a.set_position(7_000_000).await;
    ctl.refresh_position().await.unwrap();
    wait_for(&mut rx, "refreshed position", |s| {
        s.position_us == 7_000_000
    })
    .await;
}

#[tokio::test]
async fn controls_reach_active_player() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let a = FakePlayer::start(bus.address(), "a", "Paused", Meta::new(1)).await;
    let b = FakePlayer::start(bus.address(), "b", "Playing", Meta::new(2)).await;
    let (mut rx, ctl) = start_watcher(&bus, &cache).await;
    wait_for(&mut rx, "player b", |s| s.player_name == "Fake b").await;
    ctl.play_pause().await.unwrap();
    ctl.next().await.unwrap();
    ctl.previous().await.unwrap();
    assert_eq!(b.calls(), ["PlayPause", "Next", "Previous"]);
    assert!(a.calls().is_empty());
}

#[tokio::test]
async fn set_position_uses_track_id() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let a = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(5)).await;
    let (mut rx, ctl) = start_watcher(&bus, &cache).await;
    wait_for(&mut rx, "player a", |s| s.available).await;
    ctl.set_position(30_000_000).await.unwrap();
    assert_eq!(a.calls(), ["SetPosition /org/nokta/track/5 30000000"]);
}

#[tokio::test]
async fn controls_without_player_are_noops() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let (_rx, ctl) = start_watcher(&bus, &cache).await;
    ctl.play_pause().await.unwrap();
    ctl.set_position(1).await.unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
}

#[tokio::test]
async fn play_pause_follows_can_play_and_can_pause() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let a = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let (mut rx, _ctl) = start_watcher(&bus, &cache).await;
    wait_for(&mut rx, "player", |s| s.available && s.can_play_pause).await;

    // A live stream: it plays but cannot pause.
    let live = Caps {
        play: true,
        pause: false,
        control: true,
    };
    a.set_caps(live).await;
    wait_for(&mut rx, "cannot pause while playing", |s| !s.can_play_pause).await;
    a.set_status("Paused").await;
    wait_for(&mut rx, "can play while paused", |s| {
        s.status == PlaybackStatus::Paused && s.can_play_pause
    })
    .await;
}

#[tokio::test]
async fn can_control_false_disables_every_control() {
    let bus = TestBus::start();
    let cache = tempfile::tempdir().unwrap();
    let a = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let (mut rx, _ctl) = start_watcher(&bus, &cache).await;
    wait_for(&mut rx, "player", |s| s.available && s.can_play_pause).await;
    a.set_caps(Caps {
        play: true,
        pause: true,
        control: false,
    })
    .await;
    wait_for(&mut rx, "no controls", |s| {
        !s.can_play_pause && !s.can_go_next && !s.can_go_previous && !s.can_seek
    })
    .await;
}
