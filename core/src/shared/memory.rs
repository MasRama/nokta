//! How noktad's allocator gives memory back.

/// Tunes glibc's malloc for a daemon that idles between short bursts of
/// work. Call it first thing in `main`, before any thread starts.
///
/// - One arena: each thread that allocates otherwise gets its own, and the
///   short-lived blocking threads that decode images leave theirs resident
///   after they exit.
/// - A fixed mmap threshold: glibc raises it after a large block is freed, so
///   the next decoded image would come from the heap and stay there. Fixed,
///   every large buffer is its own mapping and goes back when freed.
///
/// Returns whether glibc took both settings; elsewhere it does nothing.
pub fn tune_allocator() -> bool {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    {
        const MMAP_THRESHOLD: libc::c_int = 128 * 1024;
        // SAFETY: mallopt only changes allocator parameters.
        unsafe {
            libc::mallopt(libc::M_ARENA_MAX, 1) == 1
                && libc::mallopt(libc::M_MMAP_THRESHOLD, MMAP_THRESHOLD) == 1
        }
    }
    #[cfg(not(all(target_os = "linux", target_env = "gnu")))]
    false
}

#[cfg(all(test, target_os = "linux", target_env = "gnu"))]
mod tests {
    #[test]
    fn glibc_takes_the_settings() {
        assert!(super::tune_allocator());
    }
}
