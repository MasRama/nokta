//! CLOCK_MONOTONIC in microseconds. GJS `GLib.get_monotonic_time()` reads the same
//! clock, so position snapshots can be compared across processes without conversion.

use rustix::time::{clock_gettime, ClockId};

pub fn monotonic_us() -> i64 {
    let ts = clock_gettime(ClockId::Monotonic);
    ts.tv_sec * 1_000_000 + ts.tv_nsec / 1_000
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
