//! Answers already read from EDS: an event's meeting link, a calendar's color.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// How long an answer, found or empty, is kept for its key.
const KEEP: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct AnswerCache {
    answers: HashMap<String, (Instant, String)>,
}

impl AnswerCache {
    /// The answer read for `key` less than 10 minutes before `now`; empty when there was none.
    pub fn get(&self, key: &str, now: Instant) -> Option<&str> {
        self.answers
            .get(key)
            .filter(|(at, _)| now.duration_since(*at) < KEEP)
            .map(|(_, answer)| answer.as_str())
    }

    /// Keeps `answer` for `key`, and forgets the answers that went stale.
    pub fn put(&mut self, key: &str, answer: String, now: Instant) {
        self.answers
            .retain(|_, (at, _)| now.duration_since(*at) < KEEP);
        self.answers.insert(key.to_owned(), (now, answer));
    }
}
