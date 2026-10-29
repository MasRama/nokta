//! System updates end to end: a fake PackageKit on the bus noktad uses as
//! its system bus, its transactions read as `io.nokta.Activities1` rows.

#![cfg(target_os = "linux")]

mod support;

use std::time::Duration;

use futures_util::StreamExt;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};
use support::fake_packagekit::FakePackageKit;
use zbus::names::InterfaceName;

const UPDATE_PACKAGES: u32 = 22;
const DOWNLOAD: u32 = 8;
const SIMULATE: u64 = 1 << 2;
const SUCCESS: u32 = 1;

type ActivityRow = (String, String, String, String, f64, i64);

async fn activities(conn: &zbus::Connection) -> zbus::Proxy<'static> {
    zbus::Proxy::new(conn, NAME, "/io/nokta/Activities", "io.nokta.Activities1")
        .await
        .unwrap()
}

/// The rows once `pred` holds for them, failing after 5 s.
async fn rows_when(
    activities: &zbus::Proxy<'_>,
    pred: impl Fn(&[ActivityRow]) -> bool,
) -> Vec<ActivityRow> {
    let props = zbus::fdo::PropertiesProxy::builder(activities.connection())
        .destination(NAME)
        .unwrap()
        .path("/io/nokta/Activities")
        .unwrap()
        .build()
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let rows: Vec<ActivityRow> = props
                .get(
                    InterfaceName::from_static_str_unchecked("io.nokta.Activities1"),
                    "Activities",
                )
                .await
                .unwrap()
                .try_into()
                .unwrap();
            if pred(&rows) {
                return rows;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("the activities in time")
}

#[tokio::test]
async fn an_update_shows_and_ends_with_its_exit() {
    let bus = TestBus::start();
    let fake = FakePackageKit::start(&bus).await;
    let _daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;
    let conn = bus.connect().await;
    let activities = activities(&conn).await;
    let mut ended = activities.receive_signal("Ended").await.unwrap();
    // Let noktad find PackageKit before the transactions begin.
    tokio::time::sleep(Duration::from_millis(500)).await;

    fake.begin("/1_sim", UPDATE_PACKAGES, SIMULATE).await;
    fake.step("/1_sim", DOWNLOAD, 10).await;
    fake.begin("/2_upd", UPDATE_PACKAGES, 0).await;
    fake.step("/2_upd", DOWNLOAD, 30).await;
    let rows = rows_when(&activities, |rows| rows.iter().any(|r| r.4 == 0.3)).await;
    let shown: Vec<_> = rows
        .iter()
        .map(|r| (r.0.as_str(), r.1.as_str(), r.2.as_str()))
        .collect();
    assert_eq!(
        shown,
        vec![("packagekit:/2_upd", "Installing updates", "Downloading")]
    );

    fake.finish("/1_sim", SUCCESS).await;
    fake.finish("/2_upd", SUCCESS).await;
    let signal = tokio::time::timeout(Duration::from_secs(5), ended.next())
        .await
        .expect("Ended in time")
        .unwrap();
    let (id, _, success, message, _): (String, String, bool, String, i64) =
        signal.body().deserialize().unwrap();
    assert_eq!(
        (id.as_str(), success, message.as_str()),
        ("packagekit:/2_upd", true, "Done")
    );
}

#[tokio::test]
async fn an_update_running_before_noktad_starts_shows() {
    let bus = TestBus::start();
    let fake = FakePackageKit::start(&bus).await;
    fake.begin("/1_upd", UPDATE_PACKAGES, 0).await;
    fake.step("/1_upd", DOWNLOAD, 40).await;
    let _daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;
    let conn = bus.connect().await;
    let rows = rows_when(&activities(&conn).await, |rows| !rows.is_empty()).await;
    assert_eq!((rows[0].0.as_str(), rows[0].4), ("packagekit:/1_upd", 0.4));
}
