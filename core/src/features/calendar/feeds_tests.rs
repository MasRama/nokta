use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::BoxFuture;
use jiff::tz::TimeZone;
use jiff::Timestamp;
use tokio::sync::watch;

use super::feeds::{address, spawn, FeedSource, FetchError, REFRESH};
use super::ics::Event;
use crate::features::settings::CalendarConfig;

const WORK: &str = "https://calendar.google.com/calendar/ical/work/private-x/basic.ics";
const HOME: &str = "webcal://p01-caldav.icloud.com/published/2/home";

/// Serves each feed's text, or fails it; counts the reads.
#[derive(Default)]
struct Fake {
    texts: Mutex<HashMap<String, Option<String>>>,
    reads: Mutex<Vec<String>>,
}

impl Fake {
    fn serve(&self, feed: &str, text: Option<&str>) {
        self.texts
            .lock()
            .unwrap()
            .insert(feed.to_owned(), text.map(str::to_owned));
    }

    fn reads(&self) -> usize {
        self.reads.lock().unwrap().len()
    }
}

impl FeedSource for Fake {
    fn fetch<'a>(&'a self, feed: &'a str) -> BoxFuture<'a, Result<String, FetchError>> {
        self.reads.lock().unwrap().push(feed.to_owned());
        let text = self.texts.lock().unwrap().get(feed).cloned().flatten();
        Box::pin(async move { text.ok_or(FetchError::TooBig) })
    }
}

fn one_event(uid: &str, title: &str) -> String {
    format!(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:{uid}\nSUMMARY:{title}\nDTSTART:20261102T020000Z\nDTEND:20261102T030000Z\nEND:VEVENT\nEND:VCALENDAR\n"
    )
}

fn calendar(feeds: &[&str]) -> CalendarConfig {
    CalendarConfig {
        feeds: feeds.iter().map(|f| (*f).to_owned()).collect(),
        ..CalendarConfig::default()
    }
}

struct Running {
    fake: Arc<Fake>,
    config: watch::Sender<CalendarConfig>,
    resumes: watch::Sender<u64>,
    events: watch::Receiver<Vec<Event>>,
}

impl Running {
    fn start(fake: Fake, config: CalendarConfig) -> Running {
        let fake = Arc::new(fake);
        let (config, config_rx) = watch::channel(config);
        let (resumes, resumes_rx) = watch::channel(0);
        let now = || "2026-11-01T00:00:00Z".parse::<Timestamp>().unwrap();
        let events = spawn(config_rx, resumes_rx, fake.clone(), now, TimeZone::UTC);
        Running {
            fake,
            config,
            resumes,
            events,
        }
    }

    /// The titles of the next events published.
    async fn published(&mut self) -> Vec<String> {
        self.events.changed().await.unwrap();
        self.events
            .borrow_and_update()
            .iter()
            .map(|e| e.title.clone())
            .collect()
    }

    /// Lets the service run, without waiting for anything it publishes.
    async fn settle(&self) {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

#[tokio::test(start_paused = true)]
async fn publishes_every_feeds_events_and_reads_them_again_on_time_and_on_wake() {
    let fake = Fake::default();
    fake.serve(WORK, Some(&one_event("a", "Standup")));
    fake.serve(HOME, Some(&one_event("b", "Dentist")));
    let mut running = Running::start(fake, calendar(&[WORK, HOME]));
    assert_eq!(running.published().await, ["Dentist", "Standup"]);
    let ids: Vec<String> = running
        .events
        .borrow()
        .iter()
        .map(|e| e.id.clone())
        .collect();
    assert!(ids[0].starts_with("1\nb\n") && ids[1].starts_with("0\na\n"));
    assert_eq!(running.fake.reads(), 2);

    tokio::time::sleep(REFRESH).await;
    running.published().await;
    assert_eq!(running.fake.reads(), 4);

    running.resumes.send_modify(|n| *n += 1);
    running.published().await;
    assert_eq!(running.fake.reads(), 6);
}

#[tokio::test(start_paused = true)]
async fn a_failing_feed_keeps_its_last_events() {
    let fake = Fake::default();
    fake.serve(WORK, Some(&one_event("a", "Standup")));
    let mut running = Running::start(fake, calendar(&[WORK]));
    assert_eq!(running.published().await, ["Standup"]);
    running.fake.serve(WORK, None);
    running.resumes.send_modify(|n| *n += 1);
    assert_eq!(running.published().await, ["Standup"]);
}

#[tokio::test(start_paused = true)]
async fn reads_again_when_the_feeds_change_and_not_for_other_calendar_settings() {
    let fake = Fake::default();
    fake.serve(WORK, Some(&one_event("a", "Standup")));
    fake.serve(HOME, Some(&one_event("b", "Dentist")));
    let mut running = Running::start(fake, calendar(&[WORK]));
    assert_eq!(running.published().await, ["Standup"]);

    running.config.send_modify(|c| c.reminder_minutes = 10);
    running.settle().await;
    assert_eq!(running.fake.reads(), 1);

    running
        .config
        .send_modify(|c| c.feeds = vec![HOME.to_owned()]);
    assert_eq!(running.published().await, ["Dentist"]);

    running.config.send_modify(|c| c.enabled = false);
    assert!(running.published().await.is_empty());
    assert_eq!(running.fake.reads(), 2);
}

#[test]
fn webcal_is_read_over_https_and_other_schemes_not_at_all() {
    assert_eq!(
        address(HOME).map(String::from).as_deref(),
        Some("https://p01-caldav.icloud.com/published/2/home")
    );
    assert_eq!(address(WORK).map(String::from).as_deref(), Some(WORK));
    assert!(address("http://example.com/a.ics").is_none());
    assert!(address("file:///C:/a.ics").is_none());
    assert!(address("webcal://").is_none());
}
