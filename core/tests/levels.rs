//! The bars that follow the music end to end: noktad runs a recorder (a
//! script here, `pw-record` for real) while a player plays and the setting
//! is on, and emits what it hears as `io.nokta.Media1.Levels`.

#![cfg(target_os = "linux")]

mod support;

use std::f64::consts::TAU;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};
use support::fake_player::{FakePlayer, Meta};

const ON: &str = "[media]\nreal_equalizer = true\n";
/// What `pw-record --help` says about raw output from PipeWire 1.4 on.
const HELP_RAW: &str = "  -a, --raw                             RAW mode";
/// An older `pw-record`, which writes raw samples to `-` without asking.
const HELP_OLD: &str = "  -v, --verbose                         Enable verbose operations";

/// A recorder that answers `--help` with `help`; else writes its arguments
/// and pid to `dir`, then plays one second of a 100 Hz tone, as 16 kHz
/// mono s16, every second.
fn recorder(dir: &Path, help: &str) -> PathBuf {
    let tone: Vec<u8> = (0..16_000)
        .flat_map(|i| {
            let t = f64::from(i) / 16_000.0;
            ((0.5 * 32_767.0 * (TAU * 100.0 * t).sin()) as i16).to_le_bytes()
        })
        .collect();
    std::fs::write(dir.join("tone.raw"), tone).unwrap();
    let script = dir.join("recorder");
    let d = dir.display();
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nif [ \"$1\" = --help ]; then echo '{help}'; exit 0; fi\n\
             echo \"$@\" > {d}/args\necho $$ > {d}/pid\n\
             while :; do cat {d}/tone.raw; sleep 1; done\n"
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    script
}

async fn start(bus: &TestBus, dir: &Path, config: &str) -> Daemon {
    start_with_help(bus, dir, config, HELP_RAW).await
}

async fn start_with_help(bus: &TestBus, dir: &Path, config: &str, help: &str) -> Daemon {
    let mut options = Daemon::options(bus, "http://127.0.0.1:9");
    options.recorder = recorder(dir, help).display().to_string();
    Daemon::start_with(bus, options, Some(config)).await
}

async fn levels(conn: &zbus::Connection) -> zbus::proxy::SignalStream<'static> {
    let media = zbus::Proxy::new(conn, NAME, "/io/nokta/Media", "io.nokta.Media1")
        .await
        .unwrap();
    media.receive_signal("Levels").await.unwrap()
}

/// Whether the process `pid` names still runs (a zombie counts as gone).
fn running(pid_file: &Path) -> bool {
    let Ok(pid) = std::fs::read_to_string(pid_file) else {
        return false;
    };
    std::fs::read_to_string(format!("/proc/{}/stat", pid.trim()))
        .is_ok_and(|stat| !stat.split(") ").nth(1).unwrap_or("").starts_with('Z'))
}

#[tokio::test]
async fn the_bars_follow_what_plays() {
    let bus = TestBus::start();
    let dir = tempfile::tempdir().unwrap();
    let _player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let _daemon = start(&bus, dir.path(), ON).await;
    let mut signals = levels(&bus.connect().await).await;
    let message = tokio::time::timeout(Duration::from_secs(5), signals.next())
        .await
        .expect("levels in time")
        .unwrap();
    let (levels,): (Vec<f64>,) = message.body().deserialize().unwrap();
    assert_eq!(levels.len(), 4);
    assert!(
        levels[0] > 0.9 && levels[1..].iter().all(|&l| l < 0.1),
        "{levels:?}"
    );

    let args = std::fs::read_to_string(dir.path().join("args")).unwrap();
    for arg in [
        "--rate 16000",
        "--channels 1",
        "--format s16",
        "application.id = io.nokta.Nokta",
        "--raw",
    ] {
        assert!(args.contains(arg), "{args}");
    }
}

#[tokio::test]
async fn an_older_pw_record_records_without_the_raw_flag() {
    let bus = TestBus::start();
    let dir = tempfile::tempdir().unwrap();
    let _player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let _daemon = start_with_help(&bus, dir.path(), ON, HELP_OLD).await;
    let args = dir.path().join("args");
    support::wait_until(Duration::from_secs(5), || {
        std::fs::read_to_string(&args).is_ok_and(|a| a.ends_with(" -\n"))
    })
    .await;
    let args = std::fs::read_to_string(&args).unwrap();
    assert!(!args.contains("--raw"), "{args}");
}

#[tokio::test]
async fn nothing_records_while_the_setting_is_off() {
    let bus = TestBus::start();
    let dir = tempfile::tempdir().unwrap();
    let _player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let _daemon = start(&bus, dir.path(), "").await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(!dir.path().join("args").exists());
}

#[tokio::test]
async fn recording_stops_2_s_after_the_music() {
    let bus = TestBus::start();
    let dir = tempfile::tempdir().unwrap();
    let player = FakePlayer::start(bus.address(), "a", "Playing", Meta::new(1)).await;
    let _daemon = start(&bus, dir.path(), ON).await;
    let pid = dir.path().join("pid");
    support::wait_until(Duration::from_secs(5), || running(&pid)).await;
    player.set_status("Paused").await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(running(&pid), "stopped before 2 s");
    support::wait_until(Duration::from_secs(3), || !running(&pid)).await;
}
