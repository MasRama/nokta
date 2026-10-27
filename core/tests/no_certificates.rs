//! noktad on a system without CA certificates (a bare container): it still
//! starts, and everything that does not need HTTPS keeps working.
//!
//! A test binary of its own because it changes the process environment.

#![cfg(target_os = "linux")]

mod support;

use std::time::Duration;

use serde_json::json;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};
use support::fake_player::{FakePlayer, Meta};
use wiremock::matchers::path;
use wiremock::{Mock, MockServer, ResponseTemplate};
use zbus::fdo::PropertiesProxy;
use zbus::names::InterfaceName;

#[tokio::test]
async fn starts_and_fetches_plain_http_without_ca_certificates() {
    let empty = tempfile::tempdir().unwrap();
    // Where rustls looks for the system's certificates.
    std::env::set_var("SSL_CERT_FILE", empty.path().join("none.pem"));
    std::env::set_var("SSL_CERT_DIR", empty.path());

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
    let p = PropertiesProxy::builder(&conn)
        .destination(NAME)
        .unwrap()
        .path("/io/nokta/Lyrics")
        .unwrap()
        .build()
        .await
        .unwrap();
    let mut status = String::new();
    for _ in 0..250 {
        let value = p
            .get(
                InterfaceName::from_static_str_unchecked("io.nokta.Lyrics1"),
                "Status",
            )
            .await
            .unwrap();
        status = String::try_from(value).unwrap();
        if status == "synced" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(status, "synced");
}
