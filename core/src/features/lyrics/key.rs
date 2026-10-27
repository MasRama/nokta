//! Identity of a track for lyrics caching.

use crate::shared::hash::sha256_hex;

/// Bumped when lookups get better, so old "not found" answers are asked again.
const VERSION: u32 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackKey {
    normalized: String,
}

impl TrackKey {
    pub fn new(artist: &str, title: &str, album: &str, length_us: i64) -> TrackKey {
        let seconds = length_us.max(0) / 1_000_000;
        TrackKey {
            normalized: format!(
                "v{VERSION}|{}|{}|{}|{seconds}",
                normalize(artist),
                normalize(title),
                normalize(album)
            ),
        }
    }

    pub fn cache_name(&self) -> String {
        sha256_hex(&self.normalized)
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
    fn cache_name_is_hex_sha256() {
        let name = TrackKey::new("a", "b", "c", 0).cache_name();
        assert_eq!(name.len(), 64);
        assert!(name.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
