//! Identity of a track for lyrics caching.

use crate::shared::hash::sha256_hex;

/// Bumped when lookups get better, so old "not found" answers are asked again.
const VERSION: u32 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackKey {
    /// Artist, title, album and whole seconds, without the version.
    normalized: String,
}

impl TrackKey {
    pub fn new(artist: &str, title: &str, album: &str, length_us: i64) -> TrackKey {
        let seconds = length_us.max(0) / 1_000_000;
        TrackKey {
            normalized: format!(
                "{}|{}|{}|{seconds}",
                normalize(artist),
                normalize(title),
                normalize(album)
            ),
        }
    }

    /// The name of the track's lyric timing: unlike `cache_name`, it stays
    /// when the lookup version changes.
    pub fn offset_name(&self) -> String {
        sha256_hex(&self.normalized)
    }

    pub fn cache_name(&self) -> String {
        sha256_hex(&format!("v{VERSION}|{}", self.normalized))
    }
}

fn normalize(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_normalizes_case_and_spaces() {
        let a = TrackKey::new(" Daft  Punk ", "Get Lucky", "RAM", 367_000_000);
        let b = TrackKey::new("daft punk", "get   lucky", "ram", 367_900_000);
        assert_eq!(a, b);
        assert_eq!(a.cache_name(), b.cache_name());
    }

    #[test]
    fn key_differs_by_length_seconds() {
        let a = TrackKey::new("a", "b", "c", 100_000_000);
        let b = TrackKey::new("a", "b", "c", 101_000_000);
        assert_ne!(a.cache_name(), b.cache_name());
    }

    #[test]
    fn older_answers_are_not_reused() {
        // Version 1 keys had no prefix; their "not found" came from a lookup
        // that did not clean up browser titles.
        let name = TrackKey::new("a", "b", "c", 0).cache_name();
        assert_ne!(name, sha256_hex("a|b|c|0"));
    }

    #[test]
    fn offset_name_ignores_the_lookup_version_and_small_length_changes() {
        let a = TrackKey::new(" Daft  Punk ", "Get Lucky", "RAM", 367_000_000);
        let b = TrackKey::new("daft punk", "get   lucky", "ram", 367_900_000);
        assert_eq!(a.offset_name(), b.offset_name());
        // A better lookup must not lose the timing the user set.
        assert_eq!(a.offset_name(), sha256_hex("daft punk|get lucky|ram|367"));
        assert_ne!(a.offset_name(), a.cache_name());
        let other = TrackKey::new("daft punk", "get lucky", "ram", 368_000_000);
        assert_ne!(a.offset_name(), other.offset_name());
    }

    #[test]
    fn cache_name_is_hex_sha256() {
        let name = TrackKey::new("a", "b", "c", 0).cache_name();
        assert_eq!(name.len(), 64);
        assert!(name.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
