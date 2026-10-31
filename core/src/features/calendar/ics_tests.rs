use jiff::tz::TimeZone;
use jiff::Timestamp;

use super::ics::{events, Event};
use super::recur::Rule;

const JAKARTA: &str = "Asia/Jakarta";

fn ts(text: &str) -> Timestamp {
    text.parse().unwrap()
}

/// A feed with these VEVENT bodies, folded at most once, with CRLF ends.
fn feed(header: &str, bodies: &[&str]) -> String {
    let mut ics = format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{header}");
    for body in bodies {
        ics.push_str("BEGIN:VEVENT\r\n");
        for line in body.lines().map(str::trim).filter(|l| !l.is_empty()) {
            ics.push_str(line);
            ics.push_str("\r\n");
        }
        ics.push_str("END:VEVENT\r\n");
    }
    ics.push_str("END:VCALENDAR\r\n");
    ics
}

/// The events of `ics` from `from` for 7 days, in Jakarta.
fn week(ics: &str, from: &str) -> Vec<Event> {
    let from = ts(from);
    let to = from
        .checked_add(jiff::SignedDuration::from_hours(7 * 24))
        .unwrap();
    events(ics, 0, from, to, &TimeZone::get(JAKARTA).unwrap())
}

/// Each event's start in UTC and title.
fn starts(events: &[Event]) -> Vec<(String, String)> {
    events
        .iter()
        .map(|e| {
            let at = Timestamp::from_millisecond(e.start_ms).unwrap();
            (at.to_string(), e.title.clone())
        })
        .collect()
}

#[test]
fn reads_a_timed_event_in_utc_a_named_zone_and_the_computers() {
    let ics = feed(
        "",
        &[
            "UID:a\nSUMMARY:Standup\nDTSTART:20261102T020000Z\nDTEND:20261102T021500Z",
            "UID:b\nSUMMARY:Review\\, again\nDTSTART;TZID=Europe/Berlin:20261103T100000\nDURATION:PT1H",
            "UID:c\nSUMMARY:Lunch\nDTSTART:20261104T120000\nDTEND:20261104T130000",
        ],
    );
    let found = week(&ics, "2026-11-01T00:00:00Z");
    assert_eq!(
        starts(&found),
        [
            ("2026-11-02T02:00:00Z".into(), "Standup".into()),
            ("2026-11-03T09:00:00Z".into(), "Review, again".into()),
            ("2026-11-04T05:00:00Z".into(), "Lunch".into()),
        ]
    );
    assert_eq!(found[0].end_ms - found[0].start_ms, 15 * 60_000);
    assert_eq!(found[1].end_ms - found[1].start_ms, 60 * 60_000);
    assert_eq!(found[0].id, format!("0\na\n{}", found[0].start_ms));
}

#[test]
fn leaves_out_all_day_cancelled_ended_and_later_events() {
    let ics = feed(
        "",
        &[
            "UID:day\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20261102\nDTEND;VALUE=DATE:20261103",
            "UID:off\nSUMMARY:Off\nSTATUS:CANCELLED\nDTSTART:20261102T020000Z",
            "UID:old\nSUMMARY:Old\nDTSTART:20261031T020000Z\nDTEND:20261031T030000Z",
            "UID:far\nSUMMARY:Far\nDTSTART:20261120T020000Z",
            "UID:now\nSUMMARY:Running\nDTSTART:20261031T230000Z\nDTEND:20261101T010000Z",
        ],
    );
    assert_eq!(
        starts(&week(&ics, "2026-11-01T00:00:00Z")),
        [("2026-10-31T23:00:00Z".into(), "Running".into())]
    );
}

#[test]
fn repeats_a_weekly_meeting_at_its_local_time_across_a_clock_change() {
    // Berlin leaves summer time on 25 October 2026: 10:00 is 08:00Z, then 09:00Z.
    let ics = feed(
        "",
        &["UID:w\nSUMMARY:Weekly\nDTSTART;TZID=Europe/Berlin:20261019T100000\nDTEND;TZID=Europe/Berlin:20261019T103000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
    );
    assert_eq!(
        starts(&week(&ics, "2026-10-21T00:00:00Z")),
        [
            ("2026-10-22T08:00:00Z".into(), "Weekly".into()),
            ("2026-10-26T09:00:00Z".into(), "Weekly".into()),
        ]
    );
}

#[test]
fn follows_count_until_interval_exdate_and_moved_times() {
    let ics = feed(
        "",
        &[
            "UID:d\nSUMMARY:Daily\nDTSTART:20261101T010000Z\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE:20261102T010000Z",
            "UID:u\nSUMMARY:Until\nDTSTART:20261101T020000Z\nRRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261105T020000Z",
            "UID:m\nSUMMARY:Moved\nDTSTART:20261101T030000Z\nRRULE:FREQ=DAILY;COUNT=2",
            "UID:m\nSUMMARY:Moved later\nRECURRENCE-ID:20261102T030000Z\nDTSTART:20261102T080000Z",
            "UID:x\nSUMMARY:Dropped\nDTSTART:20261101T040000Z\nRRULE:FREQ=DAILY;COUNT=2",
            "UID:x\nRECURRENCE-ID:20261102T040000Z\nSTATUS:CANCELLED\nDTSTART:20261102T040000Z",
        ],
    );
    let found = week(&ics, "2026-11-01T00:00:00Z");
    assert_eq!(
        starts(&found),
        [
            ("2026-11-01T01:00:00Z".into(), "Daily".into()),
            ("2026-11-01T02:00:00Z".into(), "Until".into()),
            ("2026-11-01T03:00:00Z".into(), "Moved".into()),
            ("2026-11-01T04:00:00Z".into(), "Dropped".into()),
            ("2026-11-02T08:00:00Z".into(), "Moved later".into()),
            ("2026-11-03T01:00:00Z".into(), "Daily".into()),
            ("2026-11-03T02:00:00Z".into(), "Until".into()),
            ("2026-11-05T02:00:00Z".into(), "Until".into()),
        ]
    );
    // A moved time keeps the id of the time it replaces.
    let moved = found.iter().find(|e| e.title == "Moved later").unwrap();
    assert_eq!(
        moved.id,
        format!("0\nm\n{}", ts("2026-11-02T03:00:00Z").as_millisecond())
    );
}

#[test]
fn reads_outlooks_windows_zone_names_from_the_feeds_own_vtimezone() {
    let ics = feed(
        "BEGIN:VTIMEZONE\r\nTZID:SE Asia Standard Time\r\nBEGIN:STANDARD\r\nDTSTART:16010101T000000\r\nTZOFFSETFROM:+0700\r\nTZOFFSETTO:+0700\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n",
        &[
            "UID:o\nSUMMARY:Outlook\nDTSTART;TZID=SE Asia Standard Time:20261102T090000\nDTEND;TZID=SE Asia Standard Time:20261102T100000",
            "UID:l\nSUMMARY:Lightning\nDTSTART;TZID=/mozilla.org/20070129_1/Asia/Tokyo:20261102T090000",
        ],
    );
    assert_eq!(
        starts(&week(&ics, "2026-11-01T00:00:00Z")),
        [
            ("2026-11-02T00:00:00Z".into(), "Lightning".into()),
            ("2026-11-02T02:00:00Z".into(), "Outlook".into()),
        ]
    );
}

#[test]
fn finds_the_meeting_link_and_color_and_ignores_alarms() {
    let ics = feed(
        "X-APPLE-CALENDAR-COLOR:#1BADF8\r\n",
        &[
            "UID:g\nSUMMARY:Call\nDTSTART:20261102T020000Z\nDESCRIPTION:Join: https://meet.google.com/abc-defg-hij\\nThanks\nBEGIN:VALARM\nSUMMARY:Alarm text\nTRIGGER:-PT10M\nEND:VALARM",
            "UID:h\nSUMMARY:Own color\nCOLOR:#ff0000\nDTSTART:20261102T030000Z",
        ],
    );
    let found = week(&ics, "2026-11-01T00:00:00Z");
    assert_eq!(found[0].title, "Call");
    assert_eq!(found[0].link, "https://meet.google.com/abc-defg-hij");
    assert_eq!(found[0].color, "#1badf8");
    assert_eq!(found[1].link, "");
    assert_eq!(found[1].color, "#ff0000");
}

#[test]
fn unfolds_lines_and_reads_quoted_parameters() {
    let ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:f\nSUMMARY:A long\n  title\nDTSTART;TZID=\"Asia/Jakarta\":20261102T090000\nATTENDEE;CN=\"Doe; Jane: x\":mailto:j@example.com\nEND:VEVENT\nEND:VCALENDAR\n";
    assert_eq!(
        starts(&week(ics, "2026-11-01T00:00:00Z")),
        [("2026-11-02T02:00:00Z".into(), "A long title".into())]
    );
}

#[test]
fn garbage_gives_no_events() {
    assert!(week("not a calendar", "2026-11-01T00:00:00Z").is_empty());
    let ics = feed(
        "",
        &["UID:z\nSUMMARY:No start", "UID:y\nDTSTART:2026-11-02"],
    );
    assert!(week(&ics, "2026-11-01T00:00:00Z").is_empty());
}

/// The first `n` days a rule lands on from `start`.
fn days(rule: &str, start: &str, n: usize) -> Vec<String> {
    let rule = Rule::parse(rule).unwrap();
    let start: jiff::civil::DateTime = start.parse().unwrap();
    rule.times(start)
        .take(n)
        .map(|t| t.date().to_string())
        .collect()
}

#[test]
fn rules_land_on_the_days_calendar_apps_show() {
    assert_eq!(
        days("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", "2026-11-03T09:00", 5),
        [
            "2026-11-03",
            "2026-11-06",
            "2026-11-17",
            "2026-11-20",
            "2026-12-01"
        ]
    );
    assert_eq!(
        days("FREQ=MONTHLY;BYDAY=-1FR", "2026-10-30T09:00", 3),
        ["2026-10-30", "2026-11-27", "2026-12-25"]
    );
    assert_eq!(
        days("FREQ=MONTHLY;BYMONTHDAY=31", "2026-10-31T09:00", 3),
        ["2026-10-31", "2026-12-31", "2027-01-31"]
    );
    assert_eq!(
        days("FREQ=MONTHLY", "2026-01-31T09:00", 3),
        ["2026-01-31", "2026-03-31", "2026-05-31"]
    );
    assert_eq!(
        days("FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "2026-03-08T09:00", 2),
        ["2026-03-08", "2027-03-14"]
    );
    assert_eq!(
        days("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR", "2026-10-30T09:00", 3),
        ["2026-10-30", "2026-11-02", "2026-11-03"]
    );
    // A rule that never lands again ends instead of looping.
    assert_eq!(
        days("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "2026-01-01T09:00", 3),
        ["2026-01-01"]
    );
}

#[test]
fn rules_this_reader_does_not_follow_are_none() {
    assert!(Rule::parse("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1").is_none());
    assert!(Rule::parse("FREQ=HOURLY").is_none());
    assert!(Rule::parse("FREQ=WEEKLY;BYDAY=2MO").is_none());
    assert!(Rule::parse("INTERVAL=2").is_none());
    assert!(Rule::parse("FREQ=DAILY;INTERVAL=0").is_none());
    assert!(Rule::parse("FREQ=WEEKLY;BYDAY=XX").is_none());
}
