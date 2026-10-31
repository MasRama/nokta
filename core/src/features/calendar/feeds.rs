//! Keeps the events of the `[calendar]` feeds, for the Windows app, which
//! has no system calendar to read. Each feed is read when the app starts,
//! when the feeds change, every 15 minutes and when the computer wakes; a
//! feed that fails keeps the events it last served. The events published
//! are those not ended yet that start in the next 7 days.
//!
//! A feed's address is a secret (it reads the calendar without a login),
//! so only its number and host are ever logged.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use futures_util::future::BoxFuture;
use jiff::tz::TimeZone;
use jiff::{SignedDuration, Timestamp};
use tokio::sync::watch;
use url::Url;

use super::ics::{self, Event};
use crate::features::settings::CalendarConfig;

/// How often the feeds are read again.
pub const REFRESH: Duration = Duration::from_secs(15 * 60);
/// How far ahead events are published.
pub const AHEAD: SignedDuration = SignedDuration::from_hours(7 * 24);
/// A feed bigger than this is not read: years of a busy calendar are a few MB.
const MAX_BYTES: usize = 10 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    /// Without the address, which is a secret.
    #[error(transparent)]
    Http(reqwest::Error),
    #[error("the server answered {0}")]
    Status(reqwest::StatusCode),
    #[error("it is over 10 MB")]
    TooBig,
    #[error("it is not an https:// or webcal:// address")]
    Address,
}

/// Where feeds come from. Implemented over HTTPS; tests inject fakes.
pub trait FeedSource: Send + Sync {
    fn fetch<'a>(&'a self, feed: &'a str) -> BoxFuture<'a, Result<String, FetchError>>;
}

pub struct HttpFeeds {
    client: reqwest::Client,
}

impl HttpFeeds {
    pub fn new(client: reqwest::Client) -> HttpFeeds {
        HttpFeeds { client }
    }
}

impl FeedSource for HttpFeeds {
    fn fetch<'a>(&'a self, feed: &'a str) -> BoxFuture<'a, Result<String, FetchError>> {
        Box::pin(async move {
            let url = address(feed).ok_or(FetchError::Address)?;
            let http = |err: reqwest::Error| FetchError::Http(err.without_url());
            let mut response = self
                .client
                .get(url)
                .timeout(TIMEOUT)
                .send()
                .await
                .map_err(http)?;
            if !response.status().is_success() {
                return Err(FetchError::Status(response.status()));
            }
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(http)? {
                if body.len() + chunk.len() > MAX_BYTES {
                    return Err(FetchError::TooBig);
                }
                body.extend_from_slice(&chunk);
            }
            Ok(String::from_utf8_lossy(&body).into_owned())
        })
    }
}

/// The address to read a feed at: `webcal://` is served over HTTPS.
pub fn address(feed: &str) -> Option<Url> {
    let feed = feed.trim();
    let url = match feed.get(..9) {
        Some(scheme) if scheme.eq_ignore_ascii_case("webcal://") => {
            Url::parse(&format!("https://{}", &feed[9..])).ok()?
        }
        _ => Url::parse(feed).ok()?,
    };
    (url.scheme() == "https" && url.host_str().is_some_and(|h| !h.is_empty())).then_some(url)
}

/// Publishes the feeds' events. `now` reads the wall clock; times with no
/// zone are in `local`.
pub fn spawn(
    config: watch::Receiver<CalendarConfig>,
    resumes: watch::Receiver<u64>,
    source: Arc<dyn FeedSource>,
    now: impl Fn() -> Timestamp + Send + 'static,
    local: TimeZone,
) -> watch::Receiver<Vec<Event>> {
    let (tx, events) = watch::channel(Vec::new());
    tokio::spawn(run(config, resumes, source, now, local, tx));
    events
}

/// The feeds to read: none when the calendar is off.
fn wanted(config: &CalendarConfig) -> Vec<String> {
    if config.enabled {
        config.feeds.clone()
    } else {
        Vec::new()
    }
}

async fn run(
    mut config: watch::Receiver<CalendarConfig>,
    mut resumes: watch::Receiver<u64>,
    source: Arc<dyn FeedSource>,
    now: impl Fn() -> Timestamp,
    local: TimeZone,
    tx: watch::Sender<Vec<Event>>,
) {
    let mut feeds = wanted(&config.borrow_and_update());
    resumes.borrow_and_update();
    let mut resumes_open = true;
    // Each feed's last text, by its address.
    let mut served: HashMap<String, String> = HashMap::new();
    // The feeds whose failure was said; said again only after one success.
    let mut failing: HashSet<String> = HashSet::new();
    loop {
        served.retain(|feed, _| feeds.contains(feed));
        failing.retain(|feed| feeds.contains(feed));
        for (i, feed) in feeds.iter().enumerate() {
            match source.fetch(feed).await {
                Ok(text) => {
                    failing.remove(feed);
                    served.insert(feed.clone(), text);
                }
                Err(err) => {
                    if failing.insert(feed.clone()) {
                        let host = address(feed).and_then(|u| u.host_str().map(str::to_owned));
                        let host = host.unwrap_or_else(|| "?".to_owned());
                        tracing::warn!("cannot read calendar feed {} on {host}: {err}", i + 1);
                    }
                }
            }
        }
        tx.send_replace(events(&feeds, &served, now(), &local));
        let wake = tokio::time::sleep(REFRESH);
        tokio::pin!(wake);
        loop {
            tokio::select! {
                changed = config.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    let next = wanted(&config.borrow_and_update());
                    if next != feeds {
                        feeds = next;
                        break;
                    }
                }
                changed = resumes.changed(), if resumes_open => {
                    if changed.is_err() {
                        resumes_open = false;
                        continue;
                    }
                    break;
                }
                () = &mut wake => break,
            }
        }
    }
}

/// The events of every feed served, soonest first.
fn events(
    feeds: &[String],
    served: &HashMap<String, String>,
    at: Timestamp,
    local: &TimeZone,
) -> Vec<Event> {
    let until = at.saturating_add(AHEAD).unwrap_or(at);
    let mut out: Vec<Event> = feeds
        .iter()
        .enumerate()
        .filter_map(|(i, feed)| Some(ics::events(served.get(feed)?, i, at, until, local)))
        .flatten()
        .collect();
    out.sort_by(|a, b| (a.start_ms, &a.title).cmp(&(b.start_ms, &b.title)));
    out
}
