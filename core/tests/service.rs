//! End-to-end tests of noktad on a private session bus.

mod support;

use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use nokta_core::app;
use serde_json::json;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};
use support::fake_player::{FakePlayer, Meta};
use wiremock::matchers::path;
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
