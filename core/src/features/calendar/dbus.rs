//! `io.nokta.Calendar1` at `/io/nokta/Calendar`.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use zbus::Connection;

use super::cache::AnswerCache;
use super::eds;
use super::link::split_event_id;

pub const PATH: &str = "/io/nokta/Calendar";

/// How long EDS gets to answer before the event counts as without one.
const EDS_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn serve(conn: &Connection) -> zbus::Result<()> {
    let iface = CalendarInterface {
        conn: conn.clone(),
        links: Mutex::new(AnswerCache::default()),
        colors: Mutex::new(AnswerCache::default()),
        warned_links: AtomicBool::new(false),
        warned_colors: AtomicBool::new(false),
    };
    conn.object_server().at(PATH, iface).await?;
    Ok(())
}

struct CalendarInterface {
    conn: Connection,
    /// By event id.
    links: Mutex<AnswerCache>,
    /// By calendar source uid.
    colors: Mutex<AnswerCache>,
    /// EDS failing is said once, not for every event.
    warned_links: AtomicBool,
    warned_colors: AtomicBool,
}

/// What `read` found within `EDS_TIMEOUT`, or empty; a failure is said once
/// per `warned`.
async fn answer(
    read: impl Future<Output = zbus::Result<Option<String>>>,
    warned: &AtomicBool,
    what: &str,
) -> String {
    let reason = match tokio::time::timeout(EDS_TIMEOUT, read).await {
        Ok(Ok(found)) => return found.unwrap_or_default(),
        Ok(Err(err)) => err.to_string(),
        Err(_) => "no answer".to_owned(),
    };
    if !warned.swap(true, Ordering::Relaxed) {
        tracing::warn!("no {what} from Evolution Data Server: {reason}");
    }
    String::new()
}

#[zbus::interface(name = "io.nokta.Calendar1")]
impl CalendarInterface {
    /// The event's meeting link, or empty.
    #[zbus(out_args("link"))]
    async fn meeting_link(&self, event_id: String) -> String {
        if let Some(link) = self.links.lock().await.get(&event_id, Instant::now()) {
            return link.to_owned();
        }
        let read = eds::read_link(&self.conn, &event_id);
        let link = answer(read, &self.warned_links, "meeting links").await;
        self.links
            .lock()
            .await
            .put(&event_id, link.clone(), Instant::now());
        link
    }

    /// The color of the event's calendar, or empty.
    #[zbus(out_args("color"))]
    async fn event_color(&self, event_id: String) -> String {
        let Some((source, _, _)) = split_event_id(&event_id) else {
            return String::new();
        };
        if let Some(color) = self.colors.lock().await.get(&source, Instant::now()) {
            return color.to_owned();
        }
        let read = eds::read_color(&self.conn, &source);
        let color = answer(read, &self.warned_colors, "calendar colors").await;
        self.colors
            .lock()
            .await
            .put(&source, color.clone(), Instant::now());
        color
    }
}
