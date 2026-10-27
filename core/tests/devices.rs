//! Device alerts end to end: a fake UPower and BlueZ on the bus noktad uses
//! as its system bus, alerts read as `io.nokta.Devices1.Alert` signals.

mod support;

use std::time::Duration;

use futures_util::StreamExt;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};
use support::fake_devices::FakeDevices;
use zbus::message::Type;
use zbus::{MatchRule, MessageStream};

const BUDS: &str = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF";

async fn alerts(bus: &TestBus) -> (zbus::Connection, MessageStream) {
    let conn = bus.connect().await;
    let rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender(NAME)
        .unwrap()
        .interface("io.nokta.Devices1")
        .unwrap()
        .member("Alert")
        .unwrap()
        .build();
    let stream = MessageStream::for_match_rule(rule, &conn, None)
        .await
        .unwrap();
    (conn, stream)
}

async fn next(stream: &mut MessageStream) -> (String, String, i32) {
    let message = tokio::time::timeout(Duration::from_secs(5), stream.next())
        .await
        .expect("timed out waiting for an Alert")
        .unwrap()
        .unwrap();
    message.body().deserialize().unwrap()
}

#[tokio::test]
async fn charger_and_bluetooth_alerts() {
    let bus = TestBus::start();
    let fake = FakeDevices::start(&bus, 76.0).await;
    fake.add_device(BUDS, "Galaxy Buds2", "audio-headset").await;
    let _daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;
    let (_conn, mut stream) = alerts(&bus).await;
    // Let noktad read the starting state, which raises no alert.
    tokio::time::sleep(Duration::from_millis(500)).await;

    fake.set_on_battery(true).await;
    assert_eq!(
        next(&mut stream).await,
        ("charger-unplugged".into(), "".into(), 76)
    );

    fake.set_connected(BUDS, true).await;
    fake.add_battery(BUDS, 82).await;
    assert_eq!(
        next(&mut stream).await,
        ("bluetooth-connected".into(), "Galaxy Buds2".into(), 82)
    );

    fake.set_connected(BUDS, false).await;
    fake.remove_battery(BUDS).await;
    assert_eq!(
        next(&mut stream).await,
        ("bluetooth-disconnected".into(), "Galaxy Buds2".into(), -1)
    );

    // No battery this time: the alert comes when the wait runs out.
    fake.set_connected(BUDS, true).await;
    assert_eq!(
        next(&mut stream).await,
        ("bluetooth-connected".into(), "Galaxy Buds2".into(), -1)
    );
}

#[tokio::test]
async fn runs_without_upower_and_bluez() {
    let bus = TestBus::start();
    let daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!daemon.task.is_finished());
}
