//! The local time zone, for `nokta alarm 07:30`.

/// Unix seconds of the next moment the local clock shows `hour:minute`,
/// after `now` (Unix seconds): today if that is still ahead, else tomorrow.
/// None when the time zone has no such moment (a skipped DST hour).
pub fn next_time_of_day(hour: u8, minute: u8, now: i64) -> Option<i64> {
    let today = local(now)?;
    for day in 0..2 {
        let mut tm = today;
        tm.tm_mday += day;
        tm.tm_hour = i32::from(hour);
        tm.tm_min = i32::from(minute);
        tm.tm_sec = 0;
        // Let mktime work out whether daylight saving applies on that day.
        tm.tm_isdst = -1;
        // SAFETY: tm is a valid, initialized struct tm; mktime only reads and
        // normalizes it. It gives -1 on failure, which is never ahead of now.
        #[allow(clippy::useless_conversion)] // time_t is i32 on some systems
        let at = i64::from(unsafe { libc::mktime(&mut tm) });
        if at > now {
            return Some(at);
        }
    }
    None
}

fn local(time: i64) -> Option<libc::tm> {
    let time = libc::time_t::try_from(time).ok()?;
    // SAFETY: a zeroed struct tm is valid (integers and a null zone pointer),
    // and localtime_r writes only into the struct it is given.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::localtime_r(&time, &mut tm) };
    (!result.is_null()).then_some(tm)
}

#[cfg(test)]
mod tests {
    use super::next_time_of_day;

    #[test]
    fn the_next_time_is_ahead_and_within_a_day() {
        let now = 1_800_000_000;
        for (hour, minute) in [(0, 0), (7, 30), (12, 0), (23, 59)] {
            let at = next_time_of_day(hour, minute, now).unwrap();
            assert!(at > now && at <= now + 25 * 3600, "{hour}:{minute}");
            assert_eq!(at % 60, 0);
        }
    }
}
