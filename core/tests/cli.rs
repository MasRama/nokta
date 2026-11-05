//! The `nokta` command against a daemon on a private bus, and without one.

#![cfg(target_os = "linux")]

mod support;

use std::process::{Command, Output};
use std::time::Duration;

use futures_util::StreamExt;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};
use wiremock::matchers::path;
use wiremock::{Mock, MockServer, ResponseTemplate};

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

/// `nokta update ARGS` against a fake GitHub at `api`, caching under `home`.
async fn nokta_update(api: &str, home: &std::path::Path, args: &[&str]) -> Output {
    let mut command = Command::new(NOKTA);
    command
        .arg("update")
        .args(args)
        .env("NOKTA_GITHUB_API_URL", api)
        .env("HOME", home)
        .env("XDG_CACHE_HOME", home.join("cache"))
        .env("DBUS_SESSION_BUS_ADDRESS", NO_BUS)
        .env("MARKER", home.join("installed"))
        .stdin(std::process::Stdio::null());
    tokio::task::spawn_blocking(move || command.output().unwrap())
        .await
        .unwrap()
}

/// A fake GitHub whose latest release is `tag`, with `files` as its assets.
async fn fake_release(tag: &str, files: &[(&str, Vec<u8>)]) -> MockServer {
    let server = MockServer::start().await;
    let assets: Vec<_> = files
        .iter()
        .map(|(name, _)| {
            serde_json::json!({
                "name": name,
                "browser_download_url": format!("{}/download/{name}", server.uri()),
            })
        })
        .collect();
    Mock::given(path("/repos/MasRama/nokta/releases/latest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "tag_name": tag,
            "html_url": format!("https://github.com/MasRama/nokta/releases/tag/{tag}"),
            "assets": assets,
        })))
        .mount(&server)
        .await;
    for (name, body) in files {
        Mock::given(path(format!("/download/{name}")))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body.clone()))
            .mount(&server)
            .await;
    }
    server
}

const TARBALL: &str = "noktad-99.0.0-x86_64-linux.tar.gz";

/// A release tarball whose install.sh only touches $MARKER.
fn fake_tarball() -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("noktad-99.0.0-x86_64-linux");
    std::fs::create_dir(&folder).unwrap();
    let installer = folder.join("install.sh");
    std::fs::write(&installer, "#!/bin/sh\ntouch \"$MARKER\"\n").unwrap();
    let status = Command::new("chmod")
        .arg("755")
        .arg(&installer)
        .status()
        .unwrap();
    assert!(status.success());
    let tarball = dir.path().join(TARBALL);
    let status = Command::new("tar")
        .arg("-czf")
        .arg(&tarball)
        .arg("-C")
        .arg(dir.path())
        .arg("noktad-99.0.0-x86_64-linux")
        .status()
        .unwrap();
    assert!(status.success());
    std::fs::read(tarball).unwrap()
}

fn sums_of(name: &str, data: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    format!("{}  {name}\n", hex::encode(Sha256::digest(data))).into_bytes()
}

#[tokio::test]
async fn update_check_says_what_is_out_and_installs_nothing() {
    let home = tempfile::tempdir().unwrap();
    let server = fake_release("v99.0.0", &[]).await;
    let out = nokta_update(&server.uri(), home.path(), &["--check"]).await;
    assert!(out.status.success(), "{out:?}");
    let said = String::from_utf8_lossy(&out.stdout);
    assert!(said.contains("Nokta 99.0.0 is available"), "{said}");

    let server = fake_release(&format!("v{}", env!("CARGO_PKG_VERSION")), &[]).await;
    let out = nokta_update(&server.uri(), home.path(), &["--yes"]).await;
    assert!(out.status.success(), "{out:?}");
    assert!(String::from_utf8_lossy(&out.stdout).contains("is the newest"));
}

#[tokio::test]
async fn update_without_yes_off_a_terminal_does_not_install() {
    let home = tempfile::tempdir().unwrap();
    let tarball = fake_tarball();
    let sums = sums_of(TARBALL, &tarball);
    let server = fake_release("v99.0.0", &[(TARBALL, tarball), ("SHA256SUMS", sums)]).await;
    let out = nokta_update(&server.uri(), home.path(), &[]).await;
    assert_eq!(out.status.code(), Some(1), "{out:?}");
    assert!(String::from_utf8_lossy(&out.stderr).contains("--yes"));
    assert!(!home.path().join("installed").exists());
}

#[cfg(target_arch = "x86_64")]
#[tokio::test]
async fn update_installs_a_tarball_that_matches_its_sum() {
    let home = tempfile::tempdir().unwrap();
    let tarball = fake_tarball();
    let sums = sums_of(TARBALL, &tarball);
    let server = fake_release("v99.0.0", &[(TARBALL, tarball), ("SHA256SUMS", sums)]).await;
    let out = nokta_update(&server.uri(), home.path(), &["--yes"]).await;
    assert!(out.status.success(), "{out:?}");
    assert!(home.path().join("installed").exists(), "install.sh ran");
}

#[cfg(target_arch = "x86_64")]
#[tokio::test]
async fn update_stops_before_unpacking_a_tarball_whose_sum_differs() {
    let home = tempfile::tempdir().unwrap();
    let tarball = fake_tarball();
    let sums = sums_of(TARBALL, b"something else");
    let server = fake_release("v99.0.0", &[(TARBALL, tarball), ("SHA256SUMS", sums)]).await;
    let out = nokta_update(&server.uri(), home.path(), &["--yes"]).await;
    assert_eq!(out.status.code(), Some(1), "{out:?}");
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("was not installed"), "{err}");
    assert!(!home.path().join("installed").exists());
    let unpacked = home
        .path()
        .join("cache/nokta/update/noktad-99.0.0-x86_64-linux");
    assert!(!unpacked.exists(), "nothing was unpacked");
}

#[cfg(target_arch = "x86_64")]
#[tokio::test]
async fn update_stops_when_the_release_has_no_sums() {
    let home = tempfile::tempdir().unwrap();
    let server = fake_release("v99.0.0", &[(TARBALL, fake_tarball())]).await;
    let out = nokta_update(&server.uri(), home.path(), &["--yes"]).await;
    assert_eq!(out.status.code(), Some(1), "{out:?}");
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("SHA256SUMS"), "{err}");
    assert!(!home.path().join("installed").exists());
}

#[tokio::test]
async fn plugins_are_installed_from_a_relative_folder_listed_and_removed() {
    let bus = TestBus::start();
    let daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;
    let work = tempfile::tempdir().unwrap();
    let source = work.path().join("hello");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(
        source.join("plugin.toml"),
        "api = 1\nid = \"hello\"\nname = \"Hello\"\n[run]\ncommand = [\"./hello.sh\"]\nevery = 60\n",
    )
    .unwrap();
    let in_work = |args: &[&str]| {
        let (address, dir) = (bus.address().to_owned(), work.path().to_owned());
        let args: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
        tokio::task::spawn_blocking(move || {
            Command::new(NOKTA)
                .args(args)
                .current_dir(dir)
                .env("DBUS_SESSION_BUS_ADDRESS", address)
                .output()
                .unwrap()
        })
    };

    let out = in_work(&["plugin", "install", "hello"]).await.unwrap();
    assert!(out.status.success(), "{out:?}");
    assert!(String::from_utf8_lossy(&out.stdout).contains("nokta plugin enable hello"));
    assert!(daemon
        .paths()
        .plugins_dir
        .join("hello/plugin.toml")
        .exists());

    let out = in_work(&["plugin", "list"]).await.unwrap();
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "hello  off  off          Hello\n"
    );

    let out = in_work(&["plugin", "enable", "nope"]).await.unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("nope"),
        "{out:?}"
    );

    let out = in_work(&["plugin", "remove", "hello"]).await.unwrap();
    assert!(out.status.success(), "{out:?}");
    assert!(!daemon.paths().plugins_dir.join("hello").exists());
}

#[tokio::test]
async fn a_plugin_is_installed_from_the_catalog_by_its_id_and_listed() {
    use sha2::{Digest, Sha256};

    const MANIFEST: &str =
        "api = 1\nid = \"water\"\nname = \"Water\"\nversion = \"1.1.0\"\n[run]\ncommand = [\"./water.sh\"]\nevery = 60\n";
    let server = MockServer::start().await;
    let index = serde_json::json!({
        "api": 1,
        "plugins": [{
            "id": "water", "name": "Water", "version": "1.1.0", "unix": true,
            "files": [{
                "path": "plugin.toml",
                "size": MANIFEST.len(),
                "sha256": hex::encode(Sha256::digest(MANIFEST.as_bytes())),
            }],
        }],
    });
    Mock::given(path("/index.json"))
        .respond_with(ResponseTemplate::new(200).set_body_string(index.to_string()))
        .mount(&server)
        .await;
    Mock::given(path("/plugins/water/plugin.toml"))
        .respond_with(ResponseTemplate::new(200).set_body_string(MANIFEST))
        .mount(&server)
        .await;
    let bus = TestBus::start();
    let mut options = Daemon::options(&bus, "http://127.0.0.1:9");
    options.plugin_catalog_url = server.uri();
    let daemon = Daemon::start_with(&bus, options, None).await;

    let out = nokta_async(bus.address(), &["plugin", "catalog"]).await;
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "water  1.1.0  Water\nInstall one with: nokta plugin install ID\n"
    );
    // No folder of that name here, so the id is looked up in the catalog.
    let out = nokta_async(bus.address(), &["plugin", "install", "water"]).await;
    assert!(out.status.success(), "{out:?}");
    assert!(String::from_utf8_lossy(&out.stdout).contains("from the catalog"));
    assert!(daemon
        .paths()
        .plugins_dir
        .join("water/plugin.toml")
        .exists());
    let out = nokta_async(bus.address(), &["plugin", "catalog"]).await;
    assert!(String::from_utf8_lossy(&out.stdout).contains("Water  installed"));

    let out = nokta_async(bus.address(), &["plugin", "update", "nope"]).await;
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("no plugin nope"));
}

#[tokio::test(flavor = "multi_thread")]
async fn creator_mode_takes_a_key_on_stdin_and_writes_a_plugin_that_starts_off() {
    use std::io::Write;

    const MANIFEST: &str = "api = 1\nid = \"btc\"\nname = \"Bitcoin\"\nversion = \"0.1.0\"\n[run]\ncommand = [\"./btc.sh\"]\nevery = 300\n";
    let draft = serde_json::json!({
        "id": "btc",
        "files": [
            {"path": "plugin.toml", "content": MANIFEST, "executable": false},
            {"path": "btc.sh", "content": "#!/bin/sh\necho '{}'\n", "executable": true},
        ],
    });
    let server = MockServer::start().await;
    Mock::given(path("/v1/messages"))
        .and(wiremock::matchers::header("x-api-key", "sk-from-stdin"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": draft.to_string()}],
        })))
        .mount(&server)
        .await;
    let bus = TestBus::start();
    let daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;

    let out = nokta_async(bus.address(), &["plugin", "create", "bitcoin price"]).await;
    assert_eq!(out.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("API key"),
        "{out:?}"
    );

    let address = bus.address().to_owned();
    let url = server.uri();
    let out = tokio::task::spawn_blocking(move || {
        let mut child = Command::new(NOKTA)
            .args([
                "plugin",
                "creator",
                "--provider",
                "anthropic",
                "--url",
                &url,
                "--key-stdin",
            ])
            .env("DBUS_SESSION_BUS_ADDRESS", &address)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(b"sk-from-stdin\n")
            .unwrap();
        child.wait_with_output().unwrap()
    })
    .await
    .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{out:?}");
    assert!(
        text.contains("API key  set") && !text.contains("sk-from"),
        "{text}"
    );

    let out = nokta_async(bus.address(), &["plugin", "create", "bitcoin price"]).await;
    assert!(out.status.success(), "{out:?}");
    assert!(String::from_utf8_lossy(&out.stdout).contains("Created btc. It is off"));
    let plugins = &daemon.paths().plugins_dir;
    assert!(plugins.join("btc/btc.sh").exists());
    let out = nokta_async(bus.address(), &["plugin", "list"]).await;
    assert!(String::from_utf8_lossy(&out.stdout).starts_with("btc  off"));
}
