//! An event's RRULE (RFC 5545 3.3.10): the days it repeats on. The parts
//! calendar apps write for meetings are read (FREQ DAILY to YEARLY,
//! INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, WKST); a rule with
//! any other BY part is not read, and its event shows once.

use std::collections::VecDeque;

use jiff::civil::{Date, DateTime, Weekday};
use jiff::ToSpan;

/// A rule that stops yielding no day for this many periods ends: a 30
/// February, or a date past the end of the calendar.
const MAX_PERIODS: i64 = 50_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// UNTIL, as written: a time in UTC, a time in the event's zone, or a day.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Until {
    Utc(DateTime),
    Local(DateTime),
    Day(Date),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub freq: Freq,
    pub interval: i64,
    /// How many times the event happens, its first time included.
    pub count: Option<u32>,
    pub until: Option<Until>,
    /// The days of the week, with their place in the month (`2MO`, `-1FR`)
    /// or 0 for every one.
    by_day: Vec<(i8, Weekday)>,
    by_month_day: Vec<i8>,
    by_month: Vec<i8>,
    week_start: Weekday,
}

impl Rule {
    /// The rule in an RRULE's value; `None` for one this reader does not follow.
    pub fn parse(value: &str) -> Option<Rule> {
        let mut rule = Rule {
            freq: Freq::Daily,
            interval: 1,
            count: None,
            until: None,
            by_day: Vec::new(),
            by_month_day: Vec::new(),
            by_month: Vec::new(),
            week_start: Weekday::Monday,
        };
        let mut freq = None;
        for part in value.split(';').filter(|p| !p.is_empty()) {
            let (key, value) = part.split_once('=')?;
            match key.to_ascii_uppercase().as_str() {
                "FREQ" => {
                    freq = Some(match value.to_ascii_uppercase().as_str() {
                        "DAILY" => Freq::Daily,
                        "WEEKLY" => Freq::Weekly,
                        "MONTHLY" => Freq::Monthly,
                        "YEARLY" => Freq::Yearly,
                        _ => return None,
                    })
                }
                "INTERVAL" => {
                    rule.interval = value.parse().ok().filter(|i| (1..=1000).contains(i))?
                }
                "COUNT" => rule.count = Some(value.parse().ok()?),
                "UNTIL" => rule.until = Some(until(value)?),
                "BYDAY" => rule.by_day = list(value, by_day)?,
                "BYMONTHDAY" => {
                    rule.by_month_day = list(value, |d| {
                        d.parse().ok().filter(|d: &i8| *d != 0 && d.abs() <= 31)
                    })?
                }
                "BYMONTH" => {
                    rule.by_month =
                        list(value, |m| m.parse().ok().filter(|m| (1..=12).contains(m)))?
                }
                "WKST" => rule.week_start = weekday(value)?,
                // A part this reader does not follow: guessing would show wrong days.
                "BYSETPOS" | "BYWEEKNO" | "BYYEARDAY" | "BYHOUR" | "BYMINUTE" | "BYSECOND"
                | "RSCALE" | "SKIP" => return None,
                _ => {}
            }
        }
        rule.freq = freq?;
        let placed = rule.by_day.iter().any(|(nth, _)| *nth != 0);
        let placed_ok = match rule.freq {
            Freq::Daily | Freq::Weekly => !placed,
            Freq::Monthly => true,
            // `20MO` of a year is not read; `-1SU` of a month in BYMONTH is.
            Freq::Yearly => !placed || !rule.by_month.is_empty(),
        };
        placed_ok.then_some(rule)
    }

    /// The times of the event from `start` on, at `start`'s time of day.
    /// `start` is the first, as calendar apps show it, even when the rule
    /// would not land on it. UNTIL is left to the caller, which knows the zone.
    pub fn times(&self, start: DateTime) -> Times<'_> {
        Times {
            rule: self,
            start,
            period: 0,
            pending: VecDeque::new(),
            given: 0,
            done: false,
        }
    }

    /// The days of one period (a day, a week, a month or a year after
    /// `start`'s), in order; `None` past the end of the calendar.
    fn period(&self, start: Date, period: i64) -> Option<Vec<Date>> {
        let step = period * self.interval;
        let days = match self.freq {
            Freq::Daily => vec![start.checked_add(step.days()).ok()?],
            Freq::Weekly => {
                let back = (start.weekday().to_monday_zero_offset()
                    - self.week_start.to_monday_zero_offset())
                .rem_euclid(7);
                let week = start
                    .checked_add((-i64::from(back)).days())
                    .ok()?
                    .checked_add((step * 7).days())
                    .ok()?;
                let weekdays: Vec<Weekday> = if self.by_day.is_empty() {
                    vec![start.weekday()]
                } else {
                    self.by_day.iter().map(|(_, day)| *day).collect()
                };
                (0..7)
                    .filter_map(|i| week.checked_add(i.days()).ok())
                    .filter(|d| weekdays.contains(&d.weekday()))
                    .collect()
            }
            Freq::Monthly => {
                let month = start.first_of_month().checked_add(step.months()).ok()?;
                self.in_month(month, start)
            }
            Freq::Yearly => {
                let year = Date::new(start.year(), 1, 1)
                    .ok()?
                    .checked_add(step.years())
                    .ok()?;
                let months = if self.by_month.is_empty() {
                    vec![start.month()]
                } else {
                    self.by_month.clone()
                };
                let mut days = Vec::new();
                for month in months {
                    let first = Date::new(year.year(), month, 1).ok()?;
                    days.extend(self.in_month(first, start));
                }
                days
            }
        };
        let mut days: Vec<Date> = days.into_iter().filter(|d| self.keeps(*d)).collect();
        days.sort();
        days.dedup();
        Some(days)
    }

    /// The days of the month starting `first` the rule lands on: its month
    /// days, else its weekdays, else `start`'s day of the month.
    fn in_month(&self, first: Date, start: Date) -> Vec<Date> {
        let length = first.days_in_month();
        let day = |day: i8| Date::new(first.year(), first.month(), day).ok();
        if !self.by_month_day.is_empty() {
            return self
                .by_month_day
                .iter()
                .map(|&d| from_end(d, length))
                .filter(|d| (1..=length).contains(d))
                .filter_map(day)
                .collect();
        }
        if !self.by_day.is_empty() {
            return self
                .by_day
                .iter()
                .flat_map(|&(nth, weekday)| {
                    let days: Vec<Date> = if nth == 0 {
                        (1..=length)
                            .filter_map(day)
                            .filter(|d| d.weekday() == weekday)
                            .collect()
                    } else {
                        first
                            .nth_weekday_of_month(nth, weekday)
                            .ok()
                            .into_iter()
                            .collect()
                    };
                    days
                })
                .collect();
        }
        // A month without `start`'s day (the 31st) is skipped, as RFC 5545 says.
        day(start.day())
            .filter(|_| start.day() <= length)
            .into_iter()
            .collect()
    }

    /// Whether the BY parts that narrow a period keep `day`.
    fn keeps(&self, day: Date) -> bool {
        let month = self.by_month.is_empty() || self.by_month.contains(&day.month());
        let weekday =
            self.by_day.is_empty() || self.by_day.iter().any(|(_, w)| *w == day.weekday());
        let month_day = self.by_month_day.is_empty()
            || self
                .by_month_day
                .iter()
                .any(|&d| from_end(d, day.days_in_month()) == day.day());
        month
            && match self.freq {
                Freq::Daily => weekday && month_day,
                Freq::Weekly => true,
                // BYDAY with BYMONTHDAY narrows the month days to those weekdays.
                Freq::Monthly | Freq::Yearly => self.by_month_day.is_empty() || weekday,
            }
    }
}

/// A BYMONTHDAY in a month `length` days long: `-1` is the last day.
fn from_end(day: i8, length: i8) -> i8 {
    if day > 0 {
        day
    } else {
        length + 1 + day
    }
}

/// The times a rule yields, in order; see [`Rule::times`].
pub struct Times<'a> {
    rule: &'a Rule,
    start: DateTime,
    period: i64,
    pending: VecDeque<Date>,
    given: u32,
    done: bool,
}

impl Iterator for Times<'_> {
    type Item = DateTime;

    fn next(&mut self) -> Option<DateTime> {
        if self.done || self.rule.count.is_some_and(|count| self.given >= count) {
            return None;
        }
        if self.given == 0 {
            self.given = 1;
            return Some(self.start);
        }
        loop {
            if let Some(day) = self.pending.pop_front() {
                if day <= self.start.date() {
                    continue;
                }
                self.given += 1;
                return Some(DateTime::from_parts(day, self.start.time()));
            }
            if self.period >= MAX_PERIODS {
                self.done = true;
                return None;
            }
            let Some(days) = self.rule.period(self.start.date(), self.period) else {
                self.done = true;
                return None;
            };
            self.pending = days.into();
            self.period += 1;
        }
    }
}

fn list<T>(value: &str, item: impl Fn(&str) -> Option<T>) -> Option<Vec<T>> {
    value.split(',').map(|v| item(v.trim())).collect()
}

/// `MO`, `2TU`, `-1FR`.
fn by_day(value: &str) -> Option<(i8, Weekday)> {
    let split = value.len().checked_sub(2)?;
    let (nth, day) = value.split_at_checked(split)?;
    let nth = match nth {
        "" => 0,
        nth => nth
            .strip_prefix('+')
            .unwrap_or(nth)
            .parse()
            .ok()
            .filter(|n: &i8| *n != 0 && n.abs() <= 53)?,
    };
    Some((nth, weekday(day)?))
}

fn weekday(value: &str) -> Option<Weekday> {
    Some(match value.to_ascii_uppercase().as_str() {
        "MO" => Weekday::Monday,
        "TU" => Weekday::Tuesday,
        "WE" => Weekday::Wednesday,
        "TH" => Weekday::Thursday,
        "FR" => Weekday::Friday,
        "SA" => Weekday::Saturday,
        "SU" => Weekday::Sunday,
        _ => return None,
    })
}

fn until(value: &str) -> Option<Until> {
    if let Some(utc) = value.strip_suffix(['Z', 'z']) {
        return Some(Until::Utc(date_time(utc)?));
    }
    if value.len() == 8 {
        return Some(Until::Day(date(value)?));
    }
    Some(Until::Local(date_time(value)?))
}

/// `YYYYMMDD`.
pub fn date(value: &str) -> Option<Date> {
    if value.len() != 8 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Date::new(
        value[..4].parse().ok()?,
        value[4..6].parse().ok()?,
        value[6..].parse().ok()?,
    )
    .ok()
}

/// `YYYYMMDDTHHMMSS`, without a zone.
pub fn date_time(value: &str) -> Option<DateTime> {
    let (day, time) = value.split_once(['T', 't'])?;
    if time.len() != 6 || !time.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let time = jiff::civil::Time::new(
        time[..2].parse().ok()?,
        time[2..4].parse().ok()?,
        // A leap second (60) is read as the second before.
        time[4..].parse::<i8>().ok()?.min(59),
        0,
    )
    .ok()?;
    Some(DateTime::from_parts(date(day)?, time))
}
