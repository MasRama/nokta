//! End-to-end tests of noktad on a private session bus.

#![cfg(target_os = "linux")]

mod support;

use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use nokta_core::app;
use serde_json::json;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};
use support::fake_player::{FakePlayer, Meta};
use wiremock::matchers::{path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};
use zbus::fdo::PropertiesProxy;
use zbus::names::InterfaceName;
use zbus::zvariant::OwnedValue;

const NO_LRCLIB: &str = "http://127.0.0.1:9";

async fn properties(conn: &zbus::Connection, path: &'static str) -> PropertiesProxy<'static> {
    PropertiesProxy::builder(conn)
        .destination(NAME)
        .unwrap()
        .path(path)
        .unwrap()
        .build()
        .await
        .unwrap()
}

fn iface(name: &'static str) -> InterfaceName<'static> {
    InterfaceName::from_static_str_unchecked(name)
}

async fn get(p: &PropertiesProxy<'_>, interface: &'static str, name: &str) -> OwnedValue {
    p.get(iface(interface), name).await.unwrap()
}

/// Waits for a `PropertiesChanged` whose changed set contains `key`.
async fn next_change_with(
    stream: &mut zbus::fdo::PropertiesChangedStream,
    key: &str,
) -> HashMap<String, OwnedValue> {
    let wait = async {
        while let Some(signal) = stream.next().await {
            let args = signal.args().unwrap();
            let changed: HashMap<String, OwnedValue> = args
                .changed_properties()
                .iter()
                .map(|(k, v)| ((*k).to_owned(), v.try_to_owned().unwrap()))
                .collect();
            if changed.contains_key(key) {
                return changed;
            }
        }
        panic!("signal stream ended");
    };
    tokio::time::timeout(Duration::from_secs(5), wait)
        .await
        .expect("no PropertiesChanged")
}

#[tokio::test]
async fn second_instance_exits_cleanly() {
    let bus = TestBus::start();
    let first = Daemon::start(&bus, NO_LRCLIB).await;
    let paths = first.paths();
    let second = tokio::time::timeout(
        Duration::from_secs(5),
        app::run(paths, Daemon::options(&bus, NO_LRCLIB)),
    )
    .await
    .expect("second instance must not keep running");
    assert!(second.is_ok());
    assert!(!first.task.is_finished());
}

#[tokio::test]
async fn reports_versions() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Nokta").await;
    assert_eq!(
        u32::try_from(get(&p, "io.nokta.Nokta1", "ApiVersion").await).unwrap(),
        1
    );
    let version = String::try_from(get(&p, "io.nokta.Nokta1", "DaemonVersion").await).unwrap();
    assert_eq!(version, env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn a_meeting_link_is_empty_without_evolution_data_server() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    for _ in 0..2 {
        let reply = conn
            .call_method(
                Some(NAME),
                "/io/nokta/Calendar",
                Some("io.nokta.Calendar1"),
                "MeetingLink",
                &("src\nuid\n",),
            )
            .await
            .unwrap();
        let link: String = reply.body().deserialize().unwrap();
        assert_eq!(link, "");
    }
}

#[tokio::test]
async fn media_properties_follow_fake_player() {
    let bus = TestBus::start();
    let player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Media").await;
    let mut changes = p.receive_properties_changed().await.unwrap();
    for _ in 0..100 {
        if String::try_from(get(&p, "io.nokta.Media1", "Title").await).unwrap() == "Song 1" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(bool::try_from(get(&p, "io.nokta.Media1", "Available").await).unwrap());

    player
        .set_meta(Meta {
            track_id: "/org/nokta/track/2".into(),
            title: "Song 2".into(),
            artists: vec!["Other".into()],
            album: "Other Album".into(),
            length_us: 123_000_000,
        })
        .await;
    let changed = next_change_with(&mut changes, "Title").await;
    assert_eq!(
        String::try_from(changed["Title"].try_clone().unwrap()).unwrap(),
        "Song 2"
    );
    assert_eq!(
        Vec::<String>::try_from(changed["Artists"].try_clone().unwrap()).unwrap(),
        ["Other"]
    );
    assert_eq!(
        String::try_from(changed["Album"].try_clone().unwrap()).unwrap(),
        "Other Album"
    );
    assert_eq!(
        i64::try_from(changed["LengthUs"].try_clone().unwrap()).unwrap(),
        123_000_000
    );
}

#[tokio::test]
async fn lyrics_status_reaches_synced() {
    let bus = TestBus::start();
    let lrclib = MockServer::start().await;
    Mock::given(path("/api/get"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "duration": 200.0, "instrumental": false,
            "plainLyrics": "hello", "syncedLyrics": "[00:01.50]hello"
        })))
        .mount(&lrclib)
        .await;
    let _player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let _daemon = Daemon::start(&bus, &lrclib.uri()).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Lyrics").await;
    let mut status = String::new();
    for _ in 0..250 {
        status = String::try_from(get(&p, "io.nokta.Lyrics1", "Status").await).unwrap();
        if status == "synced" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(status, "synced");
    let lines = Vec::<(i64, String)>::try_from(get(&p, "io.nokta.Lyrics1", "Lines").await).unwrap();
    assert_eq!(lines, [(1_500_000, "hello".to_owned())]);
}

#[tokio::test]
async fn set_offset_shifts_the_lines_in_one_signal_and_keeps_them() {
    let bus = TestBus::start();
    let lrclib = MockServer::start().await;
    Mock::given(path("/api/get"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "duration": 200.0, "instrumental": false,
            "plainLyrics": "hello", "syncedLyrics": "[00:01.50]hello"
        })))
        .mount(&lrclib)
        .await;
    let daemon = Daemon::start(&bus, &lrclib.uri()).await;
    let conn = bus.connect().await;
    let lyrics = zbus::Proxy::new(&conn, NAME, "/io/nokta/Lyrics", "io.nokta.Lyrics1")
        .await
        .unwrap();
    let no_track: zbus::Result<()> = lyrics.call("SetOffset", &(500i64,)).await;
    assert!(no_track.is_err(), "no track, nothing to keep it for");

    let _player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let p = properties(&conn, "/io/nokta/Lyrics").await;
    for _ in 0..250 {
        if String::try_from(get(&p, "io.nokta.Lyrics1", "Status").await).unwrap() == "synced" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(
        i64::try_from(get(&p, "io.nokta.Lyrics1", "OffsetMs").await).unwrap(),
        0
    );
    let mut changes = p.receive_properties_changed().await.unwrap();

    let _: () = lyrics.call("SetOffset", &(500i64,)).await.unwrap();
    let changed = next_change_with(&mut changes, "OffsetMs").await;
    assert_eq!(
        i64::try_from(changed["OffsetMs"].try_clone().unwrap()).unwrap(),
        500
    );
    let lines = Vec::<(i64, String)>::try_from(changed["Lines"].try_clone().unwrap()).unwrap();
    assert_eq!(
        lines,
        [(1_000_000, "hello".to_owned())],
        "in the same signal"
    );
    let saved = std::fs::read_to_string(daemon.paths().lyrics_offsets_file).unwrap();
    assert!(saved.contains("= 500"), "{saved}");

    let _: () = lyrics.call("SetOffset", &(-99_999i64,)).await.unwrap();
    assert_eq!(
        i64::try_from(get(&p, "io.nokta.Lyrics1", "OffsetMs").await).unwrap(),
        -30_000,
        "clamped, and published before SetOffset returns"
    );
}

#[tokio::test]
async fn settings_reload_emits_change() {
    let bus = TestBus::start();
    let daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Settings").await;
    let appearance = get(&p, "io.nokta.Settings1", "Appearance").await;
    let appearance = HashMap::<String, OwnedValue>::try_from(appearance).unwrap();
    assert_eq!(
        u32::try_from(appearance["height"].try_clone().unwrap()).unwrap(),
        32
    );

    let mut changes = p.receive_properties_changed().await.unwrap();
    std::fs::write(daemon.paths().config_file, "[appearance]\nheight = 40\n").unwrap();
    let changed = next_change_with(&mut changes, "Appearance").await;
    let appearance =
        HashMap::<String, OwnedValue>::try_from(changed["Appearance"].try_clone().unwrap())
            .unwrap();
    assert_eq!(
        u32::try_from(appearance["height"].try_clone().unwrap()).unwrap(),
        40
    );
    assert!(!changed.contains_key("Behavior"));
}

#[tokio::test]
async fn a_picture_is_prepared_and_published() {
    let bus = TestBus::start();
    let daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Settings").await;
    assert_eq!(
        String::try_from(get(&p, "io.nokta.Settings1", "PicturePath").await).unwrap(),
        ""
    );
    let mut changes = p.receive_properties_changed().await.unwrap();
    let source = daemon.config_home.path().join("sea.png");
    image::RgbImage::from_pixel(40, 20, image::Rgb([30, 90, 200]))
        .save(&source)
        .unwrap();
    let settings = settings_proxy(&conn).await;
    let value = zbus::zvariant::Value::from(source.to_str().unwrap());
    let _: () = settings
        .call("Set", &("appearance", "picture", value))
        .await
        .unwrap();
    let changed = next_change_with(&mut changes, "PicturePath").await;
    let path = String::try_from(changed["PicturePath"].try_clone().unwrap()).unwrap();
    assert!(
        path.starts_with(daemon.cache_home.path().to_str().unwrap()),
        "{path}"
    );
    assert!(std::path::Path::new(&path).is_file());
    assert_eq!(
        String::try_from(get(&p, "io.nokta.Settings1", "PictureTone").await).unwrap(),
        "#1e5ac8"
    );
    assert!(
        !String::try_from(get(&p, "io.nokta.Settings1", "PictureColor").await)
            .unwrap()
            .is_empty()
    );

    let value = zbus::zvariant::Value::from("");
    let _: () = settings
        .call("Set", &("appearance", "picture", value))
        .await
        .unwrap();
    let changed = next_change_with(&mut changes, "PicturePath").await;
    assert_eq!(
        String::try_from(changed["PicturePath"].try_clone().unwrap()).unwrap(),
        ""
    );
}

async fn settings_proxy(conn: &zbus::Connection) -> zbus::Proxy<'static> {
    zbus::Proxy::new(conn, NAME, "/io/nokta/Settings", "io.nokta.Settings1")
        .await
        .unwrap()
}

#[tokio::test]
async fn set_writes_the_file_and_publishes_it() {
    let bus = TestBus::start();
    let daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Settings").await;
    let mut changes = p.receive_properties_changed().await.unwrap();
    let settings = settings_proxy(&conn).await;

    let value = zbus::zvariant::Value::from("24h");
    let _: () = settings
        .call("Set", &("behavior", "clock_format", value))
        .await
        .unwrap();
    let changed = next_change_with(&mut changes, "Behavior").await;
    let behavior =
        HashMap::<String, OwnedValue>::try_from(changed["Behavior"].try_clone().unwrap()).unwrap();
    assert_eq!(
        String::try_from(behavior["clock_format"].try_clone().unwrap()).unwrap(),
        "24h"
    );
    let text = std::fs::read_to_string(daemon.paths().config_file).unwrap();
    assert!(text.contains("clock_format = \"24h\""), "{text}");
    assert!(
        text.starts_with("# Nokta configuration."),
        "comments are kept"
    );

    let lyrics = zbus::zvariant::Value::from(false);
    let _: () = settings
        .call("Set", &("lyrics", "enabled", lyrics))
        .await
        .unwrap();
    let changed = next_change_with(&mut changes, "Lyrics").await;
    let table =
        HashMap::<String, OwnedValue>::try_from(changed["Lyrics"].try_clone().unwrap()).unwrap();
    assert!(!bool::try_from(table["enabled"].try_clone().unwrap()).unwrap());

    let tiles = zbus::zvariant::Value::new(vec!["screenshot", "settings"]);
    let _: () = settings
        .call("Set", &("home", "tiles", tiles))
        .await
        .unwrap();
    let changed = next_change_with(&mut changes, "Home").await;
    let table =
        HashMap::<String, OwnedValue>::try_from(changed["Home"].try_clone().unwrap()).unwrap();
    assert_eq!(
        Vec::<String>::try_from(table["tiles"].try_clone().unwrap()).unwrap(),
        ["screenshot", "settings"]
    );
}

#[tokio::test]
async fn bad_set_changes_nothing_and_reset_restores_defaults() {
    let bus = TestBus::start();
    let daemon =
        Daemon::start_with_config(&bus, NO_LRCLIB, Some("[appearance]\nheight = 40 # mine\n"))
            .await;
    let conn = bus.connect().await;
    let settings = settings_proxy(&conn).await;
    let path = daemon.paths().config_file;

    let err = settings
        .call::<_, _, ()>(
            "Set",
            &("appearance", "height", zbus::zvariant::Value::U32(5)),
        )
        .await
        .unwrap_err();
    let zbus::Error::MethodError(name, Some(message), _) = err else {
        panic!("unexpected error {err:?}");
    };
    assert_eq!(name.as_str(), "org.freedesktop.DBus.Error.InvalidArgs");
    assert!(message.contains("appearance.height"), "{message}");
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "[appearance]\nheight = 40 # mine\n"
    );

    let _: () = settings.call("Reset", &()).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        nokta_core::features::settings::DEFAULT_CONFIG_TOML
    );
}

#[tokio::test]
async fn invalid_config_keeps_last_good_settings() {
    let bus = TestBus::start();
    let daemon =
        Daemon::start_with_config(&bus, NO_LRCLIB, Some("[appearance]\nheight = 40\n")).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Settings").await;
    std::fs::write(
        daemon.paths().config_file,
        "[appearance]\nheight = \"tall\"\n",
    )
    .unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;
    let appearance = get(&p, "io.nokta.Settings1", "Appearance").await;
    let appearance = HashMap::<String, OwnedValue>::try_from(appearance).unwrap();
    assert_eq!(
        u32::try_from(appearance["height"].try_clone().unwrap()).unwrap(),
        40
    );
}

#[tokio::test]
async fn play_pause_method_reaches_player() {
    let bus = TestBus::start();
    let player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Media").await;
    for _ in 0..100 {
        if bool::try_from(get(&p, "io.nokta.Media1", "Available").await).unwrap() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    conn.call_method(
        Some(NAME),
        "/io/nokta/Media",
        Some("io.nokta.Media1"),
        "PlayPause",
        &(),
    )
    .await
    .unwrap();
    conn.call_method(
        Some(NAME),
        "/io/nokta/Media",
        Some("io.nokta.Media1"),
        "SetPosition",
        &(5_000_000i64,),
    )
    .await
    .unwrap();
    assert_eq!(
        player.calls(),
        ["PlayPause", "SetPosition /org/nokta/track/1 5000000"]
    );
}

async fn wait_available(p: &PropertiesProxy<'_>) {
    for _ in 0..100 {
        if bool::try_from(get(p, "io.nokta.Media1", "Available").await).unwrap() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("no player became available");
}

#[tokio::test]
async fn shuffle_and_repeat_follow_the_player() {
    let bus = TestBus::start();
    let player = FakePlayer::start_looping(bus.address(), "a", Meta::new(1)).await;
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Media").await;
    wait_available(&p).await;
    let flag = |v: OwnedValue| bool::try_from(v).unwrap();
    assert!(flag(get(&p, "io.nokta.Media1", "CanShuffle").await));
    assert!(flag(get(&p, "io.nokta.Media1", "CanLoop").await));
    assert!(!flag(get(&p, "io.nokta.Media1", "Shuffle").await));
    assert_eq!(
        String::try_from(get(&p, "io.nokta.Media1", "LoopStatus").await).unwrap(),
        "None"
    );

    let mut changes = p.receive_properties_changed().await.unwrap();
    let media = zbus::Proxy::new(&conn, NAME, "/io/nokta/Media", "io.nokta.Media1")
        .await
        .unwrap();
    let _: () = media.call("SetShuffle", &(true,)).await.unwrap();
    let changed = next_change_with(&mut changes, "Shuffle").await;
    assert!(bool::try_from(changed["Shuffle"].try_clone().unwrap()).unwrap());
    let _: () = media.call("SetLoopStatus", &("Track",)).await.unwrap();
    let changed = next_change_with(&mut changes, "LoopStatus").await;
    assert_eq!(
        String::try_from(changed["LoopStatus"].try_clone().unwrap()).unwrap(),
        "Track"
    );
    let err = media
        .call::<_, _, ()>("SetLoopStatus", &("Forever",))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("InvalidArgs"), "{err}");
    assert_eq!(player.calls(), ["Shuffle true", "LoopStatus Track"]);
}

#[tokio::test]
async fn a_player_without_shuffle_or_repeat_has_neither() {
    let bus = TestBus::start();
    let player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Media").await;
    wait_available(&p).await;
    for name in ["CanShuffle", "CanLoop", "Shuffle"] {
        assert!(
            !bool::try_from(get(&p, "io.nokta.Media1", name).await).unwrap(),
            "{name}"
        );
    }
    conn.call_method(
        Some(NAME),
        "/io/nokta/Media",
        Some("io.nokta.Media1"),
        "SetShuffle",
        &(true,),
    )
    .await
    .unwrap();
    assert!(player.calls().is_empty());
}

#[tokio::test]
async fn timer_starts_pauses_and_stops_over_dbus() {
    let bus = TestBus::start();
    let _daemon =
        Daemon::start_with_config(&bus, NO_LRCLIB, Some("[timer]\nfocus_minutes = 50\n")).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Timer").await;
    let mut changes = p.receive_properties_changed().await.unwrap();
    let timer = zbus::Proxy::new(&conn, NAME, "/io/nokta/Timer", "io.nokta.Timer1")
        .await
        .unwrap();
    assert_eq!(
        String::try_from(get(&p, "io.nokta.Timer1", "State").await).unwrap(),
        "idle"
    );

    let _: () = timer.call("Start", &("focus",)).await.unwrap();
    let changed = next_change_with(&mut changes, "State").await;
    let text = |key: &str| String::try_from(changed[key].try_clone().unwrap()).unwrap();
    assert_eq!(
        (text("State"), text("Phase")),
        ("running".into(), "focus".into())
    );
    let duration = i64::try_from(changed["DurationUs"].try_clone().unwrap()).unwrap();
    assert_eq!(duration, 50 * 60_000_000);

    let _: () = timer.call("Pause", &()).await.unwrap();
    let changed = next_change_with(&mut changes, "State").await;
    assert_eq!(
        String::try_from(changed["State"].try_clone().unwrap()).unwrap(),
        "paused"
    );

    let _: () = timer.call("Stop", &()).await.unwrap();
    let changed = next_change_with(&mut changes, "State").await;
    assert_eq!(
        String::try_from(changed["State"].try_clone().unwrap()).unwrap(),
        "idle"
    );

    let err = timer
        .call::<_, _, ()>("Start", &("nap",))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("InvalidArgs"), "{err}");
}

type ClockRow = (String, String, String, bool, i64, i64, i64, i64);

#[tokio::test]
async fn clocks_add_pause_and_finish_over_dbus() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Timer").await;
    let mut changes = p.receive_properties_changed().await.unwrap();
    let timer = zbus::Proxy::new(&conn, NAME, "/io/nokta/Timer", "io.nokta.Timer1")
        .await
        .unwrap();
    let mut done = timer.receive_signal("ClockDone").await.unwrap();
    let clocks = |changed: &HashMap<String, OwnedValue>| {
        Vec::<ClockRow>::try_from(changed["Clocks"].try_clone().unwrap()).unwrap()
    };

    let watch: String = timer.call("AddStopwatch", &("Run",)).await.unwrap();
    let rows = clocks(&next_change_with(&mut changes, "Clocks").await);
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (
            rows[0].0.as_str(),
            rows[0].1.as_str(),
            rows[0].2.as_str(),
            rows[0].3
        ),
        (watch.as_str(), "stopwatch", "Run", true)
    );

    let _: () = timer.call("PauseClock", &(&watch,)).await.unwrap();
    let rows = clocks(&next_change_with(&mut changes, "Clocks").await);
    assert!(!rows[0].3);

    let tea: String = timer
        .call("AddCountdown", &("Tea", 1_000_000_i64))
        .await
        .unwrap();
    let rows = clocks(&next_change_with(&mut changes, "Clocks").await);
    assert_eq!(
        (rows[0].0.as_str(), rows[0].1.as_str(), rows[0].4),
        (tea.as_str(), "countdown", 1_000_000)
    );

    let signal = tokio::time::timeout(Duration::from_secs(5), done.next())
        .await
        .expect("the countdown finishes")
        .unwrap();
    let (id, kind, label): (String, String, String) = signal.body().deserialize().unwrap();
    assert_eq!(
        (id.as_str(), kind.as_str(), label.as_str()),
        (tea.as_str(), "countdown", "Tea")
    );

    let err = timer
        .call::<_, _, String>("AddCountdown", &("", 0_i64))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("InvalidArgs"), "{err}");

    let _: () = timer.call("ClearClocks", &()).await.unwrap();
    loop {
        if clocks(&next_change_with(&mut changes, "Clocks").await).is_empty() {
            break;
        }
    }
}

type ActivityRow = (String, String, String, String, f64, i64);

#[tokio::test]
async fn activities_set_and_end_over_dbus() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Activities").await;
    let mut changes = p.receive_properties_changed().await.unwrap();
    let activities = zbus::Proxy::new(&conn, NAME, "/io/nokta/Activities", "io.nokta.Activities1")
        .await
        .unwrap();
    let mut ended = activities.receive_signal("Ended").await.unwrap();

    let _: () = activities
        .call("Set", &("build", "cargo build", "nokta-core", "", 0.25))
        .await
        .unwrap();
    let changed = next_change_with(&mut changes, "Activities").await;
    let rows: Vec<ActivityRow> = changed["Activities"]
        .try_clone()
        .unwrap()
        .try_into()
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (
            rows[0].0.as_str(),
            rows[0].1.as_str(),
            rows[0].2.as_str(),
            rows[0].4
        ),
        ("build", "cargo build", "nokta-core", 0.25)
    );
    assert!(rows[0].5 > 0, "start time is monotonic µs");

    let _: () = activities
        .call("End", &("build", false, "exit code 101"))
        .await
        .unwrap();
    let signal = tokio::time::timeout(Duration::from_secs(5), ended.next())
        .await
        .expect("Ended in time")
        .unwrap();
    let (id, title, success, message, elapsed): (String, String, bool, String, i64) =
        signal.body().deserialize().unwrap();
    assert_eq!(
        (id.as_str(), title.as_str(), success, message.as_str()),
        ("build", "cargo build", false, "exit code 101")
    );
    assert!(elapsed >= 0);

    let err = activities
        .call::<_, _, ()>("Set", &("x", "", "", "", -1.0))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("InvalidArgs"), "{err}");
}

#[tokio::test]
async fn weather_reaches_ready_and_refresh_keeps_a_fresh_reading() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/forecast"))
        .and(query_param("latitude", "-6.2"))
        .and(query_param("temperature_unit", "celsius"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "current": {"temperature_2m": 31.2, "weather_code": 2, "is_day": 1},
            "daily": {"temperature_2m_max": [33.4], "temperature_2m_min": [25.1]}
        })))
        .expect(1)
        .mount(&server)
        .await;
    let bus = TestBus::start();
    let mut options = Daemon::options(&bus, NO_LRCLIB);
    options.open_meteo = app::OpenMeteoUrls {
        forecast: server.uri(),
        geocoding: server.uri(),
    };
    let config = "[weather]\nlocation = \"-6.2,106.8\"\n";
    let _daemon = Daemon::start_with(&bus, options, Some(config)).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Weather").await;
    const WEATHER: &str = "io.nokta.Weather1";

    for _ in 0..250 {
        let status: String = get(&p, WEATHER, "Status").await.try_into().unwrap();
        if status == "ready" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let text = |v: OwnedValue| -> String { v.try_into().unwrap() };
    let number = |v: OwnedValue| -> f64 { v.try_into().unwrap() };
    assert_eq!(text(get(&p, WEATHER, "Status").await), "ready");
    assert_eq!(number(get(&p, WEATHER, "Temperature").await), 31.2);
    assert_eq!(number(get(&p, WEATHER, "High").await), 33.4);
    assert_eq!(number(get(&p, WEATHER, "Low").await), 25.1);
    assert_eq!(text(get(&p, WEATHER, "Units").await), "celsius");
    assert_eq!(text(get(&p, WEATHER, "Condition").await), "partly-cloudy");
    assert_eq!(text(get(&p, WEATHER, "Place").await), "");
    let is_day: bool = get(&p, WEATHER, "IsDay").await.try_into().unwrap();
    assert!(is_day);

    let weather = zbus::Proxy::new(&conn, NAME, "/io/nokta/Weather", WEATHER)
        .await
        .unwrap();
    let _: () = weather.call("Refresh", &()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    // The mock's expect(1) fails the test on drop if a fresh reading was asked again.
}

#[tokio::test]
async fn files_added_to_the_shelf_are_listed_until_removed() {
    let bus = TestBus::start();
    let daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let file = daemon.cache_home.path().join("two words.txt");
    std::fs::write(&file, "x").unwrap();
    let uri = url::Url::from_file_path(&file).unwrap().to_string();
    let conn = bus.connect().await;
    const SHELF: &str = "io.nokta.Shelf1";
    let shelf = zbus::Proxy::new(&conn, NAME, "/io/nokta/Shelf", SHELF)
        .await
        .unwrap();
    let p = properties(&conn, "/io/nokta/Shelf").await;
    let items = || async {
        let v: Vec<(String, String, String)> = get(&p, SHELF, "Items").await.try_into().unwrap();
        v
    };

    let _: () = shelf
        .call(
            "Add",
            &(vec![uri.clone(), "https://example.com/a.txt".to_owned()],),
        )
        .await
        .unwrap();
    let mut listed = items().await;
    for _ in 0..100 {
        if !listed.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        listed = items().await;
    }
    assert_eq!(
        listed,
        [(
            uri.clone(),
            "two words.txt".to_owned(),
            "text-x-generic".to_owned()
        )]
    );

    let _: () = shelf.call("Remove", &(uri,)).await.unwrap();
    for _ in 0..100 {
        if items().await.is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the item stayed on the shelf");
}

#[tokio::test]
async fn copies_are_kept_given_back_and_cleared() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    const CLIPBOARD: &str = "io.nokta.Clipboard1";
    let clipboard = zbus::Proxy::new(&conn, NAME, "/io/nokta/Clipboard", CLIPBOARD)
        .await
        .unwrap();
    let p = properties(&conn, "/io/nokta/Clipboard").await;
    type Row = (String, String, String, String, bool, i64);
    let items = || async {
        let v: Vec<Row> = get(&p, CLIPBOARD, "Items").await.try_into().unwrap();
        v
    };
    let paused = || async {
        let v: bool = get(&p, CLIPBOARD, "Paused").await.try_into().unwrap();
        v
    };

    let _: () = clipboard
        .call("Add", &("text", "first line\nsecond", Vec::<u8>::new()))
        .await
        .unwrap();
    let mut listed = items().await;
    for _ in 0..100 {
        if !listed.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        listed = items().await;
    }
    assert_eq!(listed.len(), 1);
    let (id, kind, preview, thumbnail, pinned, time) = listed[0].clone();
    assert_eq!(
        (kind.as_str(), preview.as_str(), thumbnail.as_str(), pinned),
        ("text", "first line", "", false)
    );
    assert!(
        time > 1_700_000_000_000_000,
        "wall clock microseconds: {time}"
    );

    let (kind, text, image): (String, String, Vec<u8>) =
        clipboard.call("Get", &(id.as_str(),)).await.unwrap();
    assert_eq!(
        (kind.as_str(), text.as_str(), image.len()),
        ("text", "first line\nsecond", 0)
    );
    let unknown: zbus::Result<(String, String, Vec<u8>)> = clipboard.call("Get", &("nope",)).await;
    assert!(unknown.is_err());

    assert!(!paused().await);
    let _: () = clipboard.call("SetPaused", &(true,)).await.unwrap();
    for _ in 0..100 {
        if paused().await {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(paused().await);

    let _: () = clipboard.call("Clear", &()).await.unwrap();
    for _ in 0..100 {
        if items().await.is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("Clear kept the entry");
}

#[tokio::test]
async fn dock_progress_becomes_an_activity_that_stops_with_its_app() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, NO_LRCLIB).await;
    let conn = bus.connect().await;
    let p = properties(&conn, "/io/nokta/Activities").await;
    let activities = zbus::Proxy::new(&conn, NAME, "/io/nokta/Activities", "io.nokta.Activities1")
        .await
        .unwrap();
    let mut ended = activities.receive_signal("Ended").await.unwrap();

    let app = bus.connect().await;
    let props: HashMap<&str, zbus::zvariant::Value<'_>> =
        HashMap::from([("progress", 0.5.into()), ("progress-visible", true.into())]);
    let rows = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            // Repeated, as an app does; the first may come before noktad listens.
            app.emit_signal(
                None::<&str>,
                "/com/canonical/unity/launcherentry/1",
                "com.canonical.Unity.LauncherEntry",
                "Update",
                &("application://nokta-test.desktop", &props),
            )
            .await
            .unwrap();
            let rows: Vec<ActivityRow> = get(&p, "io.nokta.Activities1", "Activities")
                .await
                .try_into()
                .unwrap();
            if !rows.is_empty() {
                return rows;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    })
    .await
    .expect("the dock progress shows within 5 s");
    assert_eq!(
        (
            rows[0].0.as_str(),
            rows[0].1.as_str(),
            rows[0].2.as_str(),
            rows[0].4
        ),
        ("app:nokta-test.desktop", "nokta-test", "In progress", 0.5)
    );

    drop(app);
    let signal = tokio::time::timeout(Duration::from_secs(5), ended.next())
        .await
        .expect("Ended in time")
        .unwrap();
    let (id, _, success, message, _): (String, String, bool, String, i64) =
        signal.body().deserialize().unwrap();
    assert_eq!(
        (id.as_str(), success, message.as_str()),
        ("app:nokta-test.desktop", false, "Stopped")
    );
}
