//! The local time zone, for `nokta alarm 07:30`.

use jiff::tz::TimeZone;
use jiff::Timestamp;

/// Unix seconds of the next moment the local clock shows `hour:minute`,
/// after `now` (Unix seconds): today if that is still ahead, else tomorrow.
/// A time summer time skips rings as late as the clock jumped; one the
/// clock shows twice rings the first time.
pub fn next_time_of_day(hour: u8, minute: u8, now: i64) -> Option<i64> {
    next_in(&TimeZone::system(), hour, minute, now)
}

fn next_in(zone: &TimeZone, hour: u8, minute: u8, now: i64) -> Option<i64> {
    let hour = i8::try_from(hour).ok()?;
    let minute = i8::try_from(minute).ok()?;
    let mut day = Timestamp::from_second(now)
        .ok()?
        .to_zoned(zone.clone())
        .date();
    for _ in 0..2 {
        let local = zone.to_ambiguous_zoned(day.at(hour, minute, 0, 0));
        let at = local.compatible().ok()?.timestamp().as_second();
        if at > now {
            return Some(at);
        }
        day = day.tomorrow().ok()?;
    }
    None
}

#[cfg(test)]
mod tests {
    use jiff::tz::TimeZone;

    use super::{next_in, next_time_of_day};

    #[test]
    fn the_next_time_is_ahead_and_within_a_day() {
        let now = 1_800_000_000;
        for (hour, minute) in [(0, 0), (7, 30), (12, 0), (23, 59)] {
            let at = next_time_of_day(hour, minute, now).unwrap();
            assert!(at > now && at <= now + 25 * 3600, "{hour}:{minute}");
            assert_eq!(at % 60, 0);
        }
    }

    fn at(text: &str) -> i64 {
        text.parse::<jiff::Zoned>().unwrap().timestamp().as_second()
    }

    #[test]
    fn today_while_ahead_else_tomorrow() {
        let jakarta = TimeZone::get("Asia/Jakarta").unwrap();
        let now = at("2027-01-15T10:00:00+07:00[Asia/Jakarta]");
        assert_eq!(
            next_in(&jakarta, 10, 30, now),
            Some(at("2027-01-15T10:30:00+07:00[Asia/Jakarta]"))
        );
        assert_eq!(
            next_in(&jakarta, 9, 0, now),
            Some(at("2027-01-16T09:00:00+07:00[Asia/Jakarta]"))
        );
    }

    #[test]
    fn a_skipped_time_rings_after_the_jump() {
        let berlin = TimeZone::get("Europe/Berlin").unwrap();
        // 02:30 does not happen on the night summer time starts.
        let now = at("2026-03-29T00:00:00+01:00[Europe/Berlin]");
        assert_eq!(
            next_in(&berlin, 2, 30, now),
            Some(at("2026-03-29T03:30:00+02:00[Europe/Berlin]"))
        );
    }

    #[test]
    fn a_time_shown_twice_rings_the_first_time() {
        let berlin = TimeZone::get("Europe/Berlin").unwrap();
        let now = at("2026-10-25T00:00:00+02:00[Europe/Berlin]");
        assert_eq!(
            next_in(&berlin, 2, 30, now),
            Some(at("2026-10-25T02:30:00+02:00[Europe/Berlin]"))
        );
    }
}
