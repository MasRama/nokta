//! A monotonic clock in microseconds. On Unix it is CLOCK_MONOTONIC: GJS
//! `GLib.get_monotonic_time()` reads the same clock, so position snapshots can
//! be compared across processes without conversion. On Windows it counts from
//! the first call, until a frontend there needs a shared time base.

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monotonic_is_non_decreasing() {
        let a = monotonic_us();
        let b = monotonic_us();
        assert!(a > 0);
        assert!(b >= a);
    }
}
