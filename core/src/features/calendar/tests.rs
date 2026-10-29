use super::link::{meeting_link, split_event_id};

/// An event with `lines` between BEGIN and END, CRLF like EDS sends it.
fn event(lines: &[&str]) -> String {
    let mut ics = vec!["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:abc"];
    ics.extend_from_slice(lines);
    ics.extend_from_slice(&["END:VEVENT", "END:VCALENDAR"]);
    ics.join("\r\n")
}

#[test]
fn the_conference_property_comes_before_the_others() {
    let ics = event(&[
        "LOCATION:https://zoom.us/j/111",
        "DESCRIPTION:Join https://teams.microsoft.com/l/meetup-join/222",
        "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij",
    ]);
    assert_eq!(
        meeting_link(&ics).as_deref(),
        Some("https://meet.google.com/abc-defg-hij")
    );
}

#[test]
fn the_search_goes_conference_url_location_description() {
    let ics = event(&[
        "DESCRIPTION:https://meet.jit.si/standup",
        "LOCATION:Room 4 / https://whereby.com/team",
        "URL:https://zoom.us/my/ren",
        "CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://acme.webex.com/meet/ren",
    ]);
    assert_eq!(
        meeting_link(&ics).as_deref(),
        Some("https://acme.webex.com/meet/ren")
    );
    let ics = event(&[
        "DESCRIPTION:https://meet.jit.si/standup",
        "LOCATION:Room 4 / https://whereby.com/team",
        "URL:https://zoom.us/my/ren",
    ]);
    assert_eq!(
        meeting_link(&ics).as_deref(),
        Some("https://zoom.us/my/ren")
    );
    let ics = event(&[
        "DESCRIPTION:https://meet.jit.si/standup",
        "LOCATION:Room 4 / https://whereby.com/team",
    ]);
    assert_eq!(
        meeting_link(&ics).as_deref(),
        Some("https://whereby.com/team")
    );
}

#[test]
fn folded_lines_and_escapes_are_undone() {
    let ics = event(&[
        "DESCRIPTION:Agenda\\nJoin: https://us02web.zoom.us/j/8",
        " 12345?pwd=abc\\, then notes\\; bye",
    ]);
    assert_eq!(
        meeting_link(&ics).as_deref(),
        Some("https://us02web.zoom.us/j/812345?pwd=abc")
    );
    // A tab folds too, and a link in angle brackets loses them.
    let ics = event(&["DESCRIPTION:Call <https://teams.live.com/meet/9>", "\tok"]);
    assert_eq!(
        meeting_link(&ics).as_deref(),
        Some("https://teams.live.com/meet/9")
    );
}

#[test]
fn only_https_links_on_known_meeting_hosts_count() {
    for rejected in [
        "http://meet.google.com/abc-defg-hij",
        "https://zoom.us.evil.com/j/1",
        "https://evilzoom.us/j/1",
        "https://meet.google.com.evil.com/abc",
        "https://meet.google.com@evil.com/abc",
        "https://zoom.us/signin",
        "https://teams.microsoft.com/settings",
        "https://webex.com.evil.com/meet/x",
        "https://example.com/meet",
    ] {
        let ics = event(&[&format!("DESCRIPTION:{rejected}")]);
        assert_eq!(meeting_link(&ics), None, "{rejected}");
    }
    // A rejected link does not hide an accepted one after it.
    let ics = event(&["DESCRIPTION:https://example.com/x and https://meet.google.com/a"]);
    assert_eq!(
        meeting_link(&ics).as_deref(),
        Some("https://meet.google.com/a")
    );
}

#[test]
fn an_event_without_a_link_has_none() {
    assert_eq!(
        meeting_link(&event(&["SUMMARY:Lunch", "LOCATION:Cafe"])),
        None
    );
    assert_eq!(meeting_link(""), None);
}

#[test]
fn the_shells_event_id_splits_into_source_uid_and_recurrence() {
    assert_eq!(
        split_event_id("src\nuid\n"),
        Some(("src".to_owned(), "uid".to_owned(), String::new()))
    );
    assert_eq!(
        split_event_id("src\nuid\n20261029T100000Z"),
        Some((
            "src".to_owned(),
            "uid".to_owned(),
            "20261029T100000Z".to_owned()
        ))
    );
    assert_eq!(split_event_id("src\nuid"), None);
    assert_eq!(split_event_id("\nuid\n"), None);
    assert_eq!(split_event_id("src\n\n"), None);
    assert_eq!(split_event_id("smoke"), None);
}

#[test]
fn a_link_is_kept_for_ten_minutes() {
    use super::cache::LinkCache;
    use std::time::{Duration, Instant};
    let start = Instant::now();
    let mut cache = LinkCache::default();
    assert_eq!(cache.get("a", start), None);
    cache.put("a", "https://meet.google.com/a".to_owned(), start);
    // An event without a link is kept too, as empty.
    cache.put("b", String::new(), start);
    let later = start + Duration::from_secs(9 * 60);
    assert_eq!(cache.get("a", later), Some("https://meet.google.com/a"));
    assert_eq!(cache.get("b", later), Some(""));
    let stale = start + Duration::from_secs(10 * 60);
    assert_eq!(cache.get("a", stale), None);
}
