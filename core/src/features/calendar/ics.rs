//! Events from an iCalendar feed (RFC 5545), as a calendar's secret address
//! serves it: the timed events of a stretch of time, repeats expanded,
//! moved and cancelled ones followed. All-day events are left out, as on
//! GNOME.

use std::collections::{HashMap, HashSet};

use jiff::civil::DateTime;
use jiff::tz::{Offset, TimeZone};
use jiff::{SignedDuration, Timestamp};

use super::color::normalize;
use super::link::{meeting_link, unescape, unfold};
use super::recur::{self, Rule, Until};

/// One time an event happens.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    /// `"<feed>\n<uid>\n<start of this time, in ms>"`; the same time of the
    /// same event keeps its id through a refresh.
    pub id: String,
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    /// Its meeting link, or empty.
    pub link: String,
    /// Its calendar's color as `#rrggbb`, or empty.
    pub color: String,
}

/// The timed events in `ics` that have not ended at `from` and start before
/// `to`, soonest first. `feed` goes in their ids; a time with no zone is in
/// `local`.
pub fn events(
    ics: &str,
    feed: usize,
    from: Timestamp,
    to: Timestamp,
    local: &TimeZone,
) -> Vec<Event> {
    let feed_text = Feed::read(ics);
    let zones = Zones {
        local,
        written: &feed_text.zones,
    };
    let parsed: Vec<Vevent> = feed_text
        .events
        .iter()
        .filter_map(|lines| Vevent::read(lines, &zones))
        .collect();
    // The times another VEVENT moved or cancelled, by their event.
    let moved: HashSet<(&str, Timestamp)> = parsed
        .iter()
        .filter_map(|e| Some((e.uid.as_str(), e.replaces?)))
        .collect();
    let mut out = Vec::new();
    for event in &parsed {
        let make = |start: Timestamp, original: Timestamp| Event {
            id: format!("{feed}\n{}\n{}", event.uid, original.as_millisecond()),
            title: event.title.clone(),
            start_ms: start.as_millisecond(),
            end_ms: start
                .saturating_add(event.length)
                .unwrap_or(start)
                .as_millisecond(),
            link: event.link.clone(),
            color: event
                .color
                .clone()
                .or_else(|| feed_text.color.clone())
                .unwrap_or_default(),
        };
        let shown = |start: Timestamp| {
            start < to && start.saturating_add(event.length).unwrap_or(start) > from
        };
        if event.cancelled {
            continue;
        }
        if let Some(original) = event.replaces {
            if shown(event.start) {
                out.push(make(event.start, original));
            }
            continue;
        }
        let Some(rule) = &event.rule else {
            if shown(event.start) {
                out.push(make(event.start, event.start));
            }
            continue;
        };
        for time in rule.times(event.local_start) {
            let Some(start) = at(&event.zone, time) else {
                continue;
            };
            let past_until = match rule.until {
                Some(Until::Utc(until)) => at(&TimeZone::UTC, until).is_some_and(|u| start > u),
                Some(Until::Local(until)) => time > until,
                Some(Until::Day(day)) => time.date() > day,
                None => false,
            };
            if past_until || start >= to {
                break;
            }
            if shown(start)
                && !event.except.contains(&start)
                && !moved.contains(&(event.uid.as_str(), start))
            {
                out.push(make(start, start));
            }
        }
    }
    out.sort_by(|a, b| (a.start_ms, &a.title).cmp(&(b.start_ms, &b.title)));
    out
}

/// A content line: its name in capitals, its parameters, its value as written.
struct Line {
    name: String,
    params: Vec<(String, String)>,
    value: String,
    /// The whole unfolded line, for the meeting link.
    raw: String,
}

impl Line {
    fn read(raw: &str) -> Option<Line> {
        let name_end = raw.find([';', ':'])?;
        let mut params = Vec::new();
        let mut quoted = false;
        let mut part_start = name_end + 1;
        let mut value_start = None;
        if raw[name_end..].starts_with(':') {
            value_start = Some(name_end + 1);
        } else {
            for (i, c) in raw.char_indices().skip_while(|(i, _)| *i <= name_end) {
                match c {
                    '"' => quoted = !quoted,
                    ';' | ':' if !quoted => {
                        if let Some((key, value)) = raw[part_start..i].split_once('=') {
                            params.push((
                                key.to_ascii_uppercase(),
                                value.trim_matches('"').to_owned(),
                            ));
                        }
                        part_start = i + 1;
                        if c == ':' {
                            value_start = Some(i + 1);
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
        Some(Line {
            name: raw[..name_end].to_ascii_uppercase(),
            params,
            value: raw[value_start?..].to_owned(),
            raw: raw.to_owned(),
        })
    }

    fn param(&self, key: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

/// A feed's parts this reader uses.
struct Feed {
    /// The calendar's own color.
    color: Option<String>,
    /// Each VTIMEZONE's standard offset, by its TZID.
    zones: HashMap<String, Offset>,
    /// Each VEVENT's own lines, without those of its alarms.
    events: Vec<Vec<Line>>,
}

impl Feed {
    fn read(ics: &str) -> Feed {
        let mut feed = Feed {
            color: None,
            zones: HashMap::new(),
            events: Vec::new(),
        };
        let mut path: Vec<String> = Vec::new();
        let mut zone: (Option<String>, Option<Offset>, Option<Offset>) = (None, None, None);
        for line in unfold(ics).iter().filter_map(|raw| Line::read(raw)) {
            let inside = path.last().map(String::as_str);
            match line.name.as_str() {
                "BEGIN" => {
                    let component = line.value.trim().to_ascii_uppercase();
                    match component.as_str() {
                        "VEVENT" => feed.events.push(Vec::new()),
                        "VTIMEZONE" => zone = (None, None, None),
                        _ => {}
                    }
                    path.push(component);
                }
                "END" => {
                    if path.pop().as_deref() == Some("VTIMEZONE") {
                        if let (Some(id), standard, daylight) = zone.clone() {
                            if let Some(offset) = standard.or(daylight) {
                                feed.zones.insert(id, offset);
                            }
                        }
                    }
                }
                "X-APPLE-CALENDAR-COLOR" | "COLOR" if inside == Some("VCALENDAR") => {
                    feed.color = feed.color.take().or_else(|| normalize(line.value.trim()));
                }
                "TZID" if inside == Some("VTIMEZONE") => {
                    zone.0 = Some(line.value.trim().to_owned())
                }
                "TZOFFSETTO" => match inside {
                    Some("STANDARD") => zone.1 = zone.1.or(offset(&line.value)),
                    Some("DAYLIGHT") => zone.2 = zone.2.or(offset(&line.value)),
                    _ => {}
                },
                _ if inside == Some("VEVENT") => {
                    if let Some(lines) = feed.events.last_mut() {
                        lines.push(line);
                    }
                }
                _ => {}
            }
        }
        feed
    }
}

/// The zones a feed's times can be in.
struct Zones<'a> {
    local: &'a TimeZone,
    /// The feed's own VTIMEZONEs, for a TZID no time zone database knows
    /// (Outlook writes Windows' names, such as `SE Asia Standard Time`).
    written: &'a HashMap<String, Offset>,
}

impl Zones<'_> {
    /// The zone a TZID names: the database's, else the one the feed wrote
    /// (its standard offset all year), else the computer's.
    fn get(&self, id: &str) -> TimeZone {
        let id = id.trim().trim_matches('"');
        if let Ok(zone) = TimeZone::get(id) {
            return zone;
        }
        // Lightning writes `/mozilla.org/20070129_1/Europe/Berlin`.
        let mut slashes = id.match_indices('/').map(|(i, _)| i + 1);
        if let Some(zone) = slashes.find_map(|i| TimeZone::get(&id[i..]).ok()) {
            return zone;
        }
        match self.written.get(id) {
            Some(offset) => TimeZone::fixed(*offset),
            None => self.local.clone(),
        }
    }

    /// A DTSTART-like line's time and zone; `None` for a day (an all-day event).
    fn time(&self, line: &Line) -> Option<(DateTime, TimeZone)> {
        if line
            .param("VALUE")
            .is_some_and(|v| v.eq_ignore_ascii_case("DATE"))
        {
            return None;
        }
        let value = line.value.trim();
        if let Some(utc) = value.strip_suffix(['Z', 'z']) {
            return Some((recur::date_time(utc)?, TimeZone::UTC));
        }
        let zone = match line.param("TZID") {
            Some(id) => self.get(id),
            None => self.local.clone(),
        };
        Some((recur::date_time(value)?, zone))
    }
}

/// One VEVENT, read.
struct Vevent {
    uid: String,
    title: String,
    zone: TimeZone,
    local_start: DateTime,
    start: Timestamp,
    length: SignedDuration,
    rule: Option<Rule>,
    /// EXDATE: times of the rule that do not happen.
    except: HashSet<Timestamp>,
    /// RECURRENCE-ID: this VEVENT moves (or cancels) this time of its event.
    replaces: Option<Timestamp>,
    cancelled: bool,
    link: String,
    color: Option<String>,
}

impl Vevent {
    /// `None` for an all-day event, or one without a start.
    fn read(lines: &[Line], zones: &Zones) -> Option<Vevent> {
        let named = |name: &str| lines.iter().find(|l| l.name == name);
        let (local_start, zone) = zones.time(named("DTSTART")?)?;
        let start = at(&zone, local_start)?;
        let end = match named("DTEND") {
            Some(line) => {
                let (time, end_zone) = zones.time(line)?;
                at(&end_zone, time)?
            }
            None => named("DURATION")
                .and_then(|l| duration(l.value.trim()))
                .and_then(|d| start.checked_add(d).ok())
                .unwrap_or(start),
        };
        let mut except = HashSet::new();
        for line in lines.iter().filter(|l| l.name == "EXDATE") {
            for value in line.value.split(',') {
                let one = Line {
                    name: line.name.clone(),
                    params: line.params.clone(),
                    value: value.to_owned(),
                    raw: String::new(),
                };
                if let Some((time, zone)) = zones.time(&one) {
                    except.extend(at(&zone, time));
                }
            }
        }
        let raw: Vec<&str> = lines.iter().map(|l| l.raw.as_str()).collect();
        Some(Vevent {
            uid: named("UID")
                .map(|l| l.value.trim().to_owned())
                .unwrap_or_default(),
            title: named("SUMMARY")
                .map(|l| unescape(&l.value).trim().to_owned())
                .unwrap_or_default(),
            zone,
            local_start,
            start,
            length: end.duration_since(start).max(SignedDuration::ZERO),
            rule: named("RRULE").and_then(|l| Rule::parse(l.value.trim())),
            except,
            replaces: named("RECURRENCE-ID")
                .and_then(|l| zones.time(l))
                .and_then(|(time, zone)| at(&zone, time)),
            cancelled: named("STATUS")
                .is_some_and(|l| l.value.trim().eq_ignore_ascii_case("CANCELLED")),
            link: meeting_link(&raw.join("\n")).unwrap_or_default(),
            color: named("COLOR").and_then(|l| normalize(l.value.trim())),
        })
    }
}

/// The moment `time` is in `zone`; a time a clock change skips is read as
/// after it.
fn at(zone: &TimeZone, time: DateTime) -> Option<Timestamp> {
    zone.to_ambiguous_timestamp(time).compatible().ok()
}

/// `+0700`, `-0330`, `+053000`.
fn offset(value: &str) -> Option<Offset> {
    let value = value.trim();
    let (sign, digits) = match value.split_at_checked(1)? {
        ("+", rest) => (1, rest),
        ("-", rest) => (-1, rest),
        _ => return None,
    };
    if !matches!(digits.len(), 4 | 6) || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let part = |i: usize| {
        digits
            .get(i..i + 2)
            .map_or(Some(0), |p| p.parse::<i32>().ok())
    };
    let seconds = part(0)? * 3600 + part(2)? * 60 + part(4)?;
    Offset::from_seconds(sign * seconds).ok()
}

/// `PT1H30M`, `P1D`, `P2W`, `-PT15M`.
fn duration(value: &str) -> Option<SignedDuration> {
    let (sign, rest) = match value.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, value.strip_prefix('+').unwrap_or(value)),
    };
    let mut rest = rest.strip_prefix('P')?;
    let mut seconds: i64 = 0;
    let mut in_time = false;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('T') {
            in_time = true;
            rest = after;
            continue;
        }
        let digits = rest.find(|c: char| !c.is_ascii_digit())?;
        let number: i64 = rest[..digits].parse().ok()?;
        let unit = match (in_time, rest[digits..].chars().next()?) {
            (false, 'W') => 7 * 86_400,
            (false, 'D') => 86_400,
            (true, 'H') => 3600,
            (true, 'M') => 60,
            (true, 'S') => 1,
            _ => return None,
        };
        seconds = seconds.checked_add(number.checked_mul(unit)?)?;
        rest = &rest[digits + 1..];
    }
    Some(SignedDuration::from_secs(sign * seconds))
}
