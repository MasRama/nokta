use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::BoxFuture;
use tokio::sync::watch;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::github::{Asset, Client, FetchError, Release};
use super::model::{check_sum, newer, sum_for, tarball_name, SumError, DAY_US, FIRST_CHECK_US};
use super::service::{self, Command, ReleaseSource};
use super::UpdateState;
use crate::features::settings::UpdatesConfig;

const SUM: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

#[test]
fn only_a_newer_final_release_is_an_update() {
    assert_eq!(newer("0.10.0", "v0.11.0"), Some("0.11.0".into()));
    assert_eq!(newer("0.10.0", "0.10.1"), Some("0.10.1".into()));
    assert_eq!(newer("0.10.0", "v1.0.0"), Some("1.0.0".into()));
    assert_eq!(newer("0.10.0", "v0.10.0"), None);
    assert_eq!(newer("0.10.0", "v0.9.9"), None);
    assert_eq!(newer("0.10.0", "v0.9.10"), None);
    assert_eq!(
        newer("0.10.0", "v1.0.0-rc.1"),
        None,
        "pre-releases are skipped"
    );
    assert_eq!(newer("0.10.0", "nightly"), None);
    assert_eq!(newer("0.10.0", "v1.0"), None);
    assert_eq!(newer("0.10.0", ""), None);
}

#[test]
fn the_sum_is_found_by_file_name() {
    let sums = format!(
        "{SUM}  noktad-0.11.0-x86_64-linux.tar.gz\n{}  nokta@nokta.io.shell-extension.zip\n",
        "0".repeat(64)
    );
    assert_eq!(
        sum_for(&sums, "noktad-0.11.0-x86_64-linux.tar.gz"),
        Some(SUM.to_owned())
    );
    assert_eq!(sum_for(&sums, "noktad-0.12.0-x86_64-linux.tar.gz"), None);
    assert_eq!(sum_for(&sums, "noktad"), None, "the whole name must match");
    // sha256sum's binary mode marks the name with *; capitals are the same sum.
    let binary = format!("{} *noktad.tar.gz", SUM.to_uppercase());
    assert_eq!(sum_for(&binary, "noktad.tar.gz"), Some(SUM.to_owned()));
    assert_eq!(
        sum_for("abc  noktad.tar.gz", "noktad.tar.gz"),
        None,
        "not a SHA-256"
    );
}

#[test]
fn a_tarball_must_match_its_listed_sum() {
    let name = tarball_name("0.11.0");
    assert_eq!(name, "noktad-0.11.0-x86_64-linux.tar.gz");
    let sums = format!("{SUM}  {name}\n");
    // SUM is the SHA-256 of "test".
    assert_eq!(check_sum(b"test", &sums, &name), Ok(()));
    assert_eq!(check_sum(b"tesT", &sums, &name), Err(SumError::Mismatch));
    assert_eq!(check_sum(b"test", "", &name), Err(SumError::NotListed));
    assert_eq!(
        check_sum(b"test", &sums, &tarball_name("0.12.0")),
        Err(SumError::NotListed)
    );
}

#[tokio::test]
async fn the_client_reads_the_latest_release() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/MasRama/nokta/releases/latest"))
        .and(header("user-agent", "Nokta/test"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "tag_name": "v0.12.0",
            "html_url": "https://github.com/MasRama/nokta/releases/tag/v0.12.0",
            "draft": false,
            "prerelease": false,
            "assets": [
                {"name": "SHA256SUMS", "browser_download_url": "https://example.com/SHA256SUMS", "size": 2},
                {"name": "noktad-0.12.0-x86_64-linux.tar.gz", "browser_download_url": "https://example.com/t.tar.gz"}
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let client = Client::new(&server.uri(), "Nokta/test");
    let release = client.latest().await.unwrap();
    assert_eq!(release.tag, "v0.12.0");
    assert_eq!(
        release.url,
        "https://github.com/MasRama/nokta/releases/tag/v0.12.0"
    );
    assert_eq!(
        release.asset("SHA256SUMS").map(|a| a.url.as_str()),
        Some("https://example.com/SHA256SUMS")
    );
    assert!(release
        .asset("nokta@nokta.io.shell-extension.zip")
        .is_none());
}

#[tokio::test]
async fn the_client_reports_no_release_as_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let client = Client::new(&server.uri(), "Nokta/test");
    assert!(matches!(
        client.latest().await,
        Err(FetchError::Status(reqwest::StatusCode::NOT_FOUND))
    ));
}

/// A release source whose answer the test changes, counting the requests.
#[derive(Default)]
struct FakeSource {
    tag: Mutex<String>,
    fail: Mutex<bool>,
    asked: AtomicUsize,
}

impl ReleaseSource for FakeSource {
    fn latest(&self) -> BoxFuture<'_, Result<Release, FetchError>> {
        Box::pin(async move {
            self.asked.fetch_add(1, Ordering::SeqCst);
            if *self.fail.lock().unwrap() {
                return Err(FetchError::Status(reqwest::StatusCode::BAD_GATEWAY));
            }
            let tag = self.tag.lock().unwrap().clone();
            Ok(Release {
                url: format!("https://example.com/{tag}"),
                tag,
                assets: vec![Asset {
                    name: "SHA256SUMS".into(),
                    url: "https://example.com/SHA256SUMS".into(),
                }],
            })
        })
    }
}

struct Rig {
    config: watch::Sender<UpdatesConfig>,
    source: Arc<FakeSource>,
    /// Added to the wall clock, as a suspend would.
    asleep_us: Arc<AtomicI64>,
    resumes: watch::Sender<u64>,
    handle: service::Handle,
}

fn rig(check: bool) -> Rig {
    let (config, config_rx) = watch::channel(UpdatesConfig { check });
    let (resumes, resumes_rx) = watch::channel(0);
    let source = Arc::new(FakeSource::default());
    *source.tag.lock().unwrap() = "v0.12.0".into();
    let asleep_us = Arc::new(AtomicI64::new(0));
    let start = tokio::time::Instant::now();
    let now = {
        let asleep_us = asleep_us.clone();
        move || {
            let elapsed = i64::try_from(start.elapsed().as_micros()).unwrap();
            1_000_000_000 + elapsed + asleep_us.load(Ordering::SeqCst)
        }
    };
    let handle = service::spawn(config_rx, source.clone(), "0.11.0", resumes_rx, now);
    Rig {
        config,
        source,
        asleep_us,
        resumes,
        handle,
    }
}

fn asked(rig: &Rig) -> usize {
    rig.source.asked.load(Ordering::SeqCst)
}

async fn advance_us(us: i64) {
    tokio::time::sleep(Duration::from_micros(u64::try_from(us).unwrap())).await;
}

fn latest(rig: &Rig) -> UpdateState {
    rig.handle.state.borrow().clone()
}

#[tokio::test(start_paused = true)]
async fn it_asks_30_s_after_start_and_then_once_a_day() {
    let rig = rig(true);
    advance_us(FIRST_CHECK_US - 1_000_000).await;
    assert_eq!(asked(&rig), 0, "nothing in the first 30 s");
    assert_eq!(latest(&rig), UpdateState::default());

    advance_us(2_000_000).await;
    assert_eq!(asked(&rig), 1);
    assert_eq!(
        latest(&rig),
        UpdateState {
            latest: "0.12.0".into(),
            url: "https://example.com/v0.12.0".into(),
        }
    );

    advance_us(DAY_US - 3_000_000).await;
    assert_eq!(asked(&rig), 1, "not again within the day");
    advance_us(3_000_000).await;
    assert_eq!(asked(&rig), 2);
}

#[tokio::test(start_paused = true)]
async fn the_running_version_or_an_older_one_is_no_update() {
    let rig = rig(true);
    *rig.source.tag.lock().unwrap() = "v0.11.0".into();
    advance_us(FIRST_CHECK_US + 1_000_000).await;
    assert_eq!(asked(&rig), 1);
    assert_eq!(latest(&rig), UpdateState::default());
}

#[tokio::test(start_paused = true)]
async fn a_failed_request_keeps_what_was_known_until_the_next_day() {
    let rig = rig(true);
    advance_us(FIRST_CHECK_US + 1_000_000).await;
    assert_eq!(latest(&rig).latest, "0.12.0");

    *rig.source.fail.lock().unwrap() = true;
    advance_us(DAY_US).await;
    assert_eq!(asked(&rig), 2);
    assert_eq!(latest(&rig).latest, "0.12.0");

    advance_us(DAY_US / 2).await;
    assert_eq!(asked(&rig), 2, "no retry before the next deadline");
}

#[tokio::test(start_paused = true)]
async fn turned_off_it_asks_nothing_and_forgets_and_turned_on_it_asks_at_once() {
    let rig = rig(true);
    advance_us(FIRST_CHECK_US + 1_000_000).await;
    assert_eq!(latest(&rig).latest, "0.12.0");

    rig.config.send_replace(UpdatesConfig { check: false });
    advance_us(1_000_000).await;
    assert_eq!(
        latest(&rig),
        UpdateState::default(),
        "off forgets the update"
    );
    advance_us(3 * DAY_US).await;
    assert_eq!(asked(&rig), 1, "off sends nothing");

    rig.config.send_replace(UpdatesConfig { check: true });
    advance_us(1_000_000).await;
    assert_eq!(asked(&rig), 2, "on again asks at once");
    assert_eq!(latest(&rig).latest, "0.12.0");
}

#[tokio::test(start_paused = true)]
async fn check_asks_now_even_when_turned_off() {
    let rig = rig(false);
    rig.handle.commands.send(Command::Check).await.unwrap();
    advance_us(1_000_000).await;
    assert_eq!(asked(&rig), 1);
    assert_eq!(latest(&rig).latest, "0.12.0");
}

#[tokio::test(start_paused = true)]
async fn a_resume_past_the_deadline_asks_at_once() {
    let rig = rig(true);
    advance_us(FIRST_CHECK_US + 1_000_000).await;
    assert_eq!(asked(&rig), 1);

    // A night asleep: the wall clock passes the deadline, the sleep did not.
    rig.asleep_us.store(DAY_US, Ordering::SeqCst);
    rig.resumes.send_replace(1);
    advance_us(1_000_000).await;
    assert_eq!(asked(&rig), 2);

    // A short nap does not.
    rig.asleep_us.store(DAY_US + 60_000_000, Ordering::SeqCst);
    rig.resumes.send_replace(2);
    advance_us(1_000_000).await;
    assert_eq!(asked(&rig), 2);
}
