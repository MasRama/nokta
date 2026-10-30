//! A monotonic clock in microseconds. On Unix it is CLOCK_MONOTONIC: GJS
//! `GLib.get_monotonic_time()` reads the same clock, so position snapshots can
//! be compared across processes without conversion. On Windows it counts from
//! the first call, until a frontend there needs a shared time base.

use std::time::Duration;

#[cfg(unix)]
pub fn monotonic_us() -> i64 {
    use rustix::time::{clock_gettime, ClockId};

    let ts = clock_gettime(ClockId::Monotonic);
    ts.tv_sec * 1_000_000 + ts.tv_nsec / 1_000
}

#[cfg(not(unix))]
pub fn monotonic_us() -> i64 {
    use std::sync::OnceLock;
    use std::time::Instant;

    static START: OnceLock<Instant> = OnceLock::new();
    let micros = START.get_or_init(Instant::now).elapsed().as_micros();
    // Starts at 1 so a timestamp is never 0, like on Unix.
    i64::try_from(micros).unwrap_or(i64::MAX).saturating_add(1)
}

/// How long to sleep for `left_us` microseconds; nothing once it is past.
pub fn wait_us(left_us: i64) -> Duration {
    Duration::from_micros(u64::try_from(left_us).unwrap_or(0))
}

/// How long until the monotonic `deadline_us`; nothing once it is past.
pub fn until_monotonic(deadline_us: i64) -> Duration {
    wait_us(deadline_us - monotonic_us())
}

/// Sleeps for `wait`, or forever without one: the branch of a `select!`
/// for a deadline that may not be set.
pub async fn sleep_for(wait: Option<Duration>) {
    match wait {
        Some(wait) => tokio::time::sleep(wait).await,
        None => std::future::pending().await,
    }
}

/// The wall clock in Unix microseconds, for what must follow the time of
/// day (alarms) or count time spent suspended.
pub fn wall_us() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    let since = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    i64::try_from(since.as_micros()).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wait_is_what_is_left_and_never_negative() {
        assert_eq!(wait_us(1_500_000), Duration::from_millis(1500));
        assert_eq!(wait_us(0), Duration::ZERO);
        assert_eq!(wait_us(-250), Duration::ZERO);
    }

    #[test]
    fn a_deadline_ahead_waits_and_one_behind_does_not() {
        let now = monotonic_us();
        assert!(until_monotonic(now + 60_000_000) > Duration::from_secs(59));
        assert_eq!(until_monotonic(now - 1), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn a_wait_ends_after_its_time_and_none_never_ends() {
        let wait = tokio::time::timeout(
            Duration::from_secs(2),
            sleep_for(Some(Duration::from_secs(1))),
        );
        assert!(wait.await.is_ok());
        let none = tokio::time::timeout(Duration::from_secs(3600), sleep_for(None));
        assert!(none.await.is_err());
    }

    #[test]
    fn monotonic_is_non_decreasing() {
        let a = monotonic_us();
        let b = monotonic_us();
        assert!(a > 0);
        assert!(b >= a);
    }
}
