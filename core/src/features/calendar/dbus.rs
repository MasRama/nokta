//! `io.nokta.Calendar1` at `/io/nokta/Calendar`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use zbus::Connection;

use super::cache::AnswerCache;
use super::eds;

pub const PATH: &str = "/io/nokta/Calendar";

/// How long EDS gets to answer before the event counts as without a link.
const EDS_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn serve(conn: &Connection) -> zbus::Result<()> {
    let iface = CalendarInterface {
        conn: conn.clone(),
        cache: Mutex::new(AnswerCache::default()),
        warned: AtomicBool::new(false),
    };
    conn.object_server().at(PATH, iface).await?;
    Ok(())
}

struct CalendarInterface {
    conn: Connection,
    cache: Mutex<AnswerCache>,
    /// EDS failing is said once, not for every event.
    warned: AtomicBool,
}

impl CalendarInterface {
    fn warn_once(&self, reason: &str) {
        if !self.warned.swap(true, Ordering::Relaxed) {
            tracing::warn!("no meeting links from Evolution Data Server: {reason}");
        }
    }
}

#[zbus::interface(name = "io.nokta.Calendar1")]
impl CalendarInterface {
    /// The event's meeting link, or empty.
    #[zbus(out_args("link"))]
    async fn meeting_link(&self, event_id: String) -> String {
        if let Some(link) = self.cache.lock().await.get(&event_id, Instant::now()) {
            return link.to_owned();
        }
        let read = tokio::time::timeout(EDS_TIMEOUT, eds::read_link(&self.conn, &event_id));
        let link = match read.await {
            Ok(Ok(link)) => link.unwrap_or_default(),
            Ok(Err(err)) => {
                self.warn_once(&err.to_string());
                String::new()
            }
            Err(_) => {
                self.warn_once("no answer");
                String::new()
            }
        };
        self.cache
            .lock()
            .await
            .put(&event_id, link.clone(), Instant::now());
        link
    }
}
