//! The running activities, with no clock: every method takes `now` in
//! monotonic microseconds.

use std::fmt;

/// More than this many at once ends the oldest.
pub const MAX_ACTIVITIES: usize = 8;

#[derive(Clone, Debug, PartialEq)]
pub struct Activity {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub icon: String,
    /// 0 to 1, or -1 when unknown.
    pub progress: f64,
    pub started_us: i64,
    updated_us: i64,
}

/// What `Set` changes.
#[derive(Clone, Debug, PartialEq)]
pub struct Update {
    pub title: String,
    pub detail: String,
    pub icon: String,
    pub progress: f64,
}

/// An activity that ended, as the `Ended` signal reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ended {
    pub id: String,
    pub title: String,
    pub success: bool,
    pub message: String,
    pub elapsed_us: i64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SetError {
    EmptyId,
    EmptyTitle,
    Progress(f64),
}

impl fmt::Display for SetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SetError::EmptyId => f.write_str("the id must not be empty"),
            SetError::EmptyTitle => f.write_str("the title must not be empty"),
            SetError::Progress(p) => write!(f, "progress must be -1 or between 0 and 1, got {p}"),
        }
    }
}

impl std::error::Error for SetError {}

#[derive(Clone, Debug, Default)]
pub struct Activities {
    /// Newest first.
    items: Vec<Activity>,
}

impl Activities {
    pub fn list(&self) -> &[Activity] {
        &self.items
    }

    /// Starts or updates `id`. Returns the oldest activity when this one
    /// pushes it out.
    pub fn set(&mut self, id: &str, update: Update, now: i64) -> Result<Option<Ended>, SetError> {
        if id.is_empty() {
            return Err(SetError::EmptyId);
        }
        if update.title.trim().is_empty() {
            return Err(SetError::EmptyTitle);
        }
        let p = update.progress;
        if p != -1.0 && !(0.0..=1.0).contains(&p) {
            return Err(SetError::Progress(p));
        }
        if let Some(item) = self.items.iter_mut().find(|a| a.id == id) {
            item.title = update.title;
            item.detail = update.detail;
            item.icon = update.icon;
            item.progress = p;
            item.updated_us = now;
            return Ok(None);
        }
        let replaced = if self.items.len() >= MAX_ACTIVITIES {
            self.items
                .pop()
                .map(|old| ended(old, false, "Replaced by a newer activity".into(), now))
        } else {
            None
        };
        self.items.insert(
            0,
            Activity {
                id: id.to_owned(),
                title: update.title,
                detail: update.detail,
                icon: update.icon,
                progress: p,
                started_us: now,
                updated_us: now,
            },
        );
        Ok(replaced)
    }

    pub fn end(&mut self, id: &str, success: bool, message: &str, now: i64) -> Option<Ended> {
        let index = self.items.iter().position(|a| a.id == id)?;
        Some(ended(
            self.items.remove(index),
            success,
            message.to_owned(),
            now,
        ))
    }

    /// Ends every activity not set for `stale_us`.
    pub fn expire(&mut self, now: i64, stale_us: i64) -> Vec<Ended> {
        let (stale, fresh) = std::mem::take(&mut self.items)
            .into_iter()
            .partition::<Vec<_>, _>(|a| now - a.updated_us >= stale_us);
        self.items = fresh;
        let message = stale_message(stale_us);
        stale
            .into_iter()
            .map(|a| ended(a, false, message.clone(), now))
            .collect()
    }

    /// When the next activity goes stale.
    pub fn next_deadline(&self, stale_us: i64) -> Option<i64> {
        self.items
            .iter()
            .map(|a| a.updated_us.saturating_add(stale_us))
            .min()
    }
}

fn ended(activity: Activity, success: bool, message: String, now: i64) -> Ended {
    Ended {
        id: activity.id,
        title: activity.title,
        success,
        message,
        elapsed_us: (now - activity.started_us).max(0),
    }
}

fn stale_message(stale_us: i64) -> String {
    let minutes = stale_us / 60_000_000;
    let unit = if minutes == 1 { "minute" } else { "minutes" };
    format!("No update for {minutes} {unit}")
}
