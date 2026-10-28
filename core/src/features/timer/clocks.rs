//! Countdowns, stopwatches and alarms, with no clock: every method takes
//! `wall`, the wall clock in Unix microseconds. They follow the wall clock
//! rather than the monotonic one so that time spent suspended counts.

/// At most this many clocks at once.
pub const MAX_CLOCKS: usize = 6;
const SECOND_US: i64 = 1_000_000;
const HOUR_US: i64 = 3_600 * SECOND_US;
/// A countdown is 1 second to 24 hours long.
pub const MAX_COUNTDOWN_US: i64 = 24 * HOUR_US;
/// An alarm is at most this far ahead.
pub const MAX_ALARM_AHEAD_US: i64 = 7 * 24 * HOUR_US;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Countdown,
    Stopwatch,
    Alarm,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Countdown => "countdown",
            Kind::Stopwatch => "stopwatch",
            Kind::Alarm => "alarm",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum AddError {
    #[error("a countdown is 1 second to 24 hours long")]
    BadLength,
    #[error("an alarm must be in the next 7 days")]
    BadTime,
    #[error("there are already {MAX_CLOCKS} clocks")]
    TooMany,
}

/// One clock as published, its value read at a given wall time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClockView {
    pub id: String,
    pub kind: Kind,
    pub label: String,
    pub running: bool,
    /// A countdown's length, else 0.
    pub duration_us: i64,
    /// Time left for a countdown or an alarm, time elapsed for a stopwatch.
    pub value_us: i64,
    /// An alarm's time, else 0.
    pub alarm_unix_us: i64,
}

/// A countdown that ran out or an alarm that went off.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Done {
    pub id: String,
    pub kind: Kind,
    pub label: String,
}

#[derive(Clone, Debug)]
struct Clock {
    id: String,
    kind: Kind,
    label: String,
    duration_us: i64,
    /// The value when `since` was set, or while paused.
    base_us: i64,
    /// The wall time it last started running; None while paused.
    since: Option<i64>,
    alarm_unix_us: i64,
}

impl Clock {
    fn value(&self, wall: i64) -> i64 {
        match self.kind {
            Kind::Alarm => (self.alarm_unix_us - wall).max(0),
            Kind::Countdown => match self.since {
                Some(since) => (self.base_us - (wall - since)).max(0),
                None => self.base_us,
            },
            Kind::Stopwatch => match self.since {
                Some(since) => self.base_us + (wall - since).max(0),
                None => self.base_us,
            },
        }
    }

    /// Microseconds until it is due; None for a stopwatch or a paused countdown.
    fn due_in(&self, wall: i64) -> Option<i64> {
        match self.kind {
            Kind::Stopwatch => None,
            Kind::Countdown if self.since.is_none() => None,
            _ => Some(self.value(wall)),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Clocks {
    /// Newest first.
    list: Vec<Clock>,
    next_id: u64,
}

impl Clocks {
    pub fn add_countdown(
        &mut self,
        label: &str,
        duration_us: i64,
        wall: i64,
    ) -> Result<String, AddError> {
        if !(SECOND_US..=MAX_COUNTDOWN_US).contains(&duration_us) {
            return Err(AddError::BadLength);
        }
        self.add(
            Kind::Countdown,
            label,
            duration_us,
            duration_us,
            Some(wall),
            0,
        )
    }

    pub fn add_stopwatch(&mut self, label: &str, wall: i64) -> Result<String, AddError> {
        self.add(Kind::Stopwatch, label, 0, 0, Some(wall), 0)
    }

    pub fn add_alarm(&mut self, label: &str, unix_us: i64, wall: i64) -> Result<String, AddError> {
        if unix_us <= wall || unix_us - wall > MAX_ALARM_AHEAD_US {
            return Err(AddError::BadTime);
        }
        self.add(Kind::Alarm, label, 0, 0, Some(wall), unix_us)
    }

    fn add(
        &mut self,
        kind: Kind,
        label: &str,
        duration_us: i64,
        base_us: i64,
        since: Option<i64>,
        alarm_unix_us: i64,
    ) -> Result<String, AddError> {
        if self.list.len() >= MAX_CLOCKS {
            return Err(AddError::TooMany);
        }
        self.next_id += 1;
        let id = format!("c{}", self.next_id);
        self.list.insert(
            0,
            Clock {
                id: id.clone(),
                kind,
                label: label.to_owned(),
                duration_us,
                base_us,
                since,
                alarm_unix_us,
            },
        );
        Ok(id)
    }

    /// True when a running countdown or stopwatch was paused.
    pub fn pause(&mut self, id: &str, wall: i64) -> bool {
        let Some(clock) = self.find(id) else {
            return false;
        };
        if clock.kind == Kind::Alarm || clock.since.is_none() {
            return false;
        }
        clock.base_us = clock.value(wall);
        clock.since = None;
        true
    }

    /// True when a paused countdown or stopwatch was resumed.
    pub fn resume(&mut self, id: &str, wall: i64) -> bool {
        let Some(clock) = self.find(id) else {
            return false;
        };
        if clock.since.is_some() {
            return false;
        }
        clock.since = Some(wall);
        true
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.list.len();
        self.list.retain(|c| c.id != id);
        self.list.len() != before
    }

    pub fn clear(&mut self) -> bool {
        let changed = !self.list.is_empty();
        self.list.clear();
        changed
    }

    /// Microseconds until the next countdown or alarm is due, 0 when one is past due.
    pub fn next_due(&self, wall: i64) -> Option<i64> {
        self.list.iter().filter_map(|c| c.due_in(wall)).min()
    }

    /// Removes the countdowns and alarms that are due, newest first.
    pub fn expire(&mut self, wall: i64) -> Vec<Done> {
        let mut done = Vec::new();
        self.list.retain(|c| {
            if c.due_in(wall) != Some(0) {
                return true;
            }
            done.push(Done {
                id: c.id.clone(),
                kind: c.kind,
                label: c.label.clone(),
            });
            false
        });
        done
    }

    pub fn views(&self, wall: i64) -> Vec<ClockView> {
        self.list
            .iter()
            .map(|c| ClockView {
                id: c.id.clone(),
                kind: c.kind,
                label: c.label.clone(),
                running: c.since.is_some(),
                duration_us: c.duration_us,
                value_us: c.value(wall),
                alarm_unix_us: c.alarm_unix_us,
            })
            .collect()
    }

    fn find(&mut self, id: &str) -> Option<&mut Clock> {
        self.list.iter_mut().find(|c| c.id == id)
    }
}
