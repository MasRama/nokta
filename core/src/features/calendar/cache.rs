//! Meeting links already read from EDS.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// How long an answer, a link or none, is kept for an event id.
const KEEP: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct LinkCache {
    links: HashMap<String, (Instant, String)>,
}

impl LinkCache {
    /// The link read for `id` less than 10 minutes before `now`; empty when it had none.
    pub fn get(&self, id: &str, now: Instant) -> Option<&str> {
        self.links
            .get(id)
            .filter(|(at, _)| now.duration_since(*at) < KEEP)
            .map(|(_, link)| link.as_str())
    }

    /// Keeps `link` for `id`, and forgets the answers that went stale.
    pub fn put(&mut self, id: &str, link: String, now: Instant) {
        self.links
            .retain(|_, (at, _)| now.duration_since(*at) < KEEP);
        self.links.insert(id.to_owned(), (now, link));
    }
}
