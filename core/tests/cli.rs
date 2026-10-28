//! The `nokta` command against a daemon on a private bus, and without one.

#![cfg(target_os = "linux")]

mod support;

use std::process::{Command, Output};
use std::time::Duration;

use futures_util::StreamExt;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};

const NOKTA: &str = env!("CARGO_BIN_EXE_nokta");

fn nokta(bus: &str, args: &[&str]) -> Output {
    Command::new(NOKTA)
        .args(args)
        .env("DBUS_SESSION_BUS_ADDRESS", bus)
        .output()
        .unwrap()
}

async fn nokta_async(bus: &str, args: &[&str]) -> Output {
    let bus = bus.to_owned();
    let args: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
    tokio::task::spawn_blocking(move || {
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        nokta(&bus, &args)
    })
    .await
    .unwrap()
}

const NO_BUS: &str = "unix:path=/nonexistent/nokta-test-bus";

#[test]
fn run_without_a_daemon_still_runs_and_passes_the_exit_code() {
    let out = nokta(NO_BUS, &["run", "--", "sh", "-c", "echo hi; exit 3"]);
    assert_eq!(out.status.code(), Some(3));
    assert_eq!(String::from_utf8_lossy(&out.stdout), "hi\n");
}

#[test]
fn bad_arguments_exit_2_with_usage() {
    let out = nokta(NO_BUS, &["activity", "set", "x"]);
    assert_eq!(out.status.code(), Some(2));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("--title") && err.contains("Usage"), "{err}");
}

#[test]
fn set_without_a_daemon_fails() {
    let out = nokta(NO_BUS, &["activity", "set", "x", "--title", "X"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("noktad"));
}

async fn ended_stream(conn: &zbus::Connection) -> zbus::proxy::SignalStream<'static> {
    let proxy = zbus::Proxy::new(conn, NAME, "/io/nokta/Activities", "io.nokta.Activities1")
        .await
        .unwrap();
    proxy.receive_signal("Ended").await.unwrap()
}

async fn next_ended(
    stream: &mut zbus::proxy::SignalStream<'static>,
) -> (String, String, bool, String, i64) {
    let signal = tokio::time::timeout(Duration::from_secs(5), stream.next())
        .await
        .expect("Ended in time")
        .unwrap();
    signal.body().deserialize().unwrap()
}

#[tokio::test]
async fn set_and_end_reach_the_daemon() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;
    let conn = bus.connect().await;
    let mut ended = ended_stream(&conn).await;
    let out = nokta_async(
        bus.address(),
        &[
            "activity",
            "set",
            "b",
            "--title",
            "Backup",
            "--progress",
            "50",
        ],
    )
    .await;
    assert!(out.status.success(), "{out:?}");
    let proxy = zbus::Proxy::new(&conn, NAME, "/io/nokta/Activities", "io.nokta.Activities1")
        .await
        .unwrap();
    let rows: Vec<(String, String, String, String, f64, i64)> =
        proxy.get_property("Activities").await.unwrap();
    assert_eq!((rows[0].1.as_str(), rows[0].4), ("Backup", 0.5));

    let out = nokta_async(
        bus.address(),
        &["activity", "end", "b", "--failed", "--message", "Disk full"],
    )
    .await;
    assert!(out.status.success(), "{out:?}");
    let (id, _, success, message, _) = next_ended(&mut ended).await;
    assert_eq!(
        (id.as_str(), success, message.as_str()),
        ("b", false, "Disk full")
    );
}

#[tokio::test]
async fn run_reports_success_and_failure() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;
    let conn = bus.connect().await;
    let mut ended = ended_stream(&conn).await;

    let out = nokta_async(bus.address(), &["run", "--", "sh", "-c", "exit 0"]).await;
    assert_eq!(out.status.code(), Some(0));
    let (_, title, success, message, _) = next_ended(&mut ended).await;
    assert_eq!(
        (title.as_str(), success, message.as_str()),
        ("sh", true, "")
    );

    let out = nokta_async(
        bus.address(),
        &["run", "--title", "Deploy", "--", "sh", "-c", "exit 2"],
    )
    .await;
    assert_eq!(out.status.code(), Some(2));
    let (_, title, success, message, _) = next_ended(&mut ended).await;
    assert_eq!(
        (title.as_str(), success, message.as_str()),
        ("Deploy", false, "Exit code 2")
    );
}
