//! `Calendar1`, only on Windows: the events of the `[calendar] feeds` the
//! core read (calendar/feeds.rs). The page lists, reminds and counts down
//! to them as the extension does with GNOME Shell's events; on Linux the
//! D-Bus `Calendar1` only answers for those, so `Events` is not in its
//! contract.

use nokta_core::features::calendar::ics::Event;
use serde_json::json;

use super::Props;

pub const INTERFACE: &str = "Calendar1";

/// `Events`: each `{id, title, start, end, link, color}`, times in ms since
/// the epoch, soonest first; `link` and `color` are empty for none.
pub fn props(events: &[Event]) -> Props {
    let mut props = Props::new();
    let events: Vec<_> = events
        .iter()
        .map(|e| {
            json!({
                "id": e.id,
                "title": e.title,
                "start": e.start_ms,
                "end": e.end_ms,
                "link": e.link,
                "color": e.color,
            })
        })
        .collect();
    props.insert("Events".into(), json!(events));
    props
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_each_event_with_its_times_in_ms() {
        let event = Event {
            id: "0\nstandup\n1793584800000".into(),
            title: "Standup".into(),
            start_ms: 1_793_584_800_000,
            end_ms: 1_793_585_700_000,
            link: "https://meet.google.com/abc-defg-hij".into(),
            color: String::new(),
        };
        assert_eq!(
            props(&[event])["Events"],
            json!([{
                "id": "0\nstandup\n1793584800000",
                "title": "Standup",
                "start": 1_793_584_800_000_i64,
                "end": 1_793_585_700_000_i64,
                "link": "https://meet.google.com/abc-defg-hij",
                "color": "",
            }])
        );
        assert_eq!(props(&[])["Events"], json!([]));
    }
}
