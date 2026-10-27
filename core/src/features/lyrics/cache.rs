//! On-disk cache of lyrics lookups, one JSON file per track.

use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::{key::TrackKey, Lookup};

/// How long a "not found" answer is trusted before LRCLIB is asked again.
pub const NOT_FOUND_TTL_S: u64 = 7 * 24 * 60 * 60;

#[derive(Serialize, Deserialize)]
struct Entry {
    fetched_at: u64,
    lookup: Lookup,
}

pub struct Cache {
    dir: PathBuf,
}

impl Cache {
    pub fn new(dir: PathBuf) -> Cache {
        Cache { dir }
    }

    pub fn get(&self, key: &TrackKey, now_unix: u64) -> Option<Lookup> {
        let text = fs::read_to_string(self.file(key)).ok()?;
        let entry: Entry = serde_json::from_str(&text).ok()?;
        let expired = entry.lookup == Lookup::NotFound
            && now_unix.saturating_sub(entry.fetched_at) > NOT_FOUND_TTL_S;
        (!expired).then_some(entry.lookup)
    }

    pub fn put(&self, key: &TrackKey, lookup: &Lookup, now_unix: u64) -> io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let entry = Entry {
            fetched_at: now_unix,
            lookup: lookup.clone(),
        };
        let file = self.file(key);
        let tmp = file.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec(&entry)?)?;
        fs::rename(tmp, file)
    }

    fn file(&self, key: &TrackKey) -> PathBuf {
        self.dir.join(format!("{}.json", key.cache_name()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::lyrics::{key::TrackKey, Line, Lookup};

    const T: u64 = 1_800_000_000;

    fn key() -> TrackKey {
        TrackKey::new("artist", "title", "album", 200_000_000)
    }

    #[test]
    fn cache_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        let lookup = Lookup::Synced(vec![Line {
            start_us: 1,
            text: "a".into(),
        }]);
        cache.put(&key(), &lookup, T).unwrap();
        assert_eq!(cache.get(&key(), T + 10), Some(lookup));
    }

    #[test]
    fn miss_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Cache::new(dir.path().to_owned()).get(&key(), T), None);
    }

    #[test]
    fn not_found_expires_after_seven_days() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        cache.put(&key(), &Lookup::NotFound, T).unwrap();
        assert_eq!(cache.get(&key(), T + 604_799), Some(Lookup::NotFound));
        assert_eq!(cache.get(&key(), T + 604_801), None);
    }

    #[test]
    fn synced_never_expires() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        let lookup = Lookup::Synced(vec![]);
        cache.put(&key(), &lookup, T).unwrap();
        assert_eq!(cache.get(&key(), T + 100 * 604_800), Some(lookup));
    }

    #[test]
    fn corrupt_cache_file_is_a_miss() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        cache.put(&key(), &Lookup::Plain, T).unwrap();
        let file = std::fs::read_dir(dir.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        std::fs::write(file, "{not json").unwrap();
        assert_eq!(cache.get(&key(), T), None);
    }
}
