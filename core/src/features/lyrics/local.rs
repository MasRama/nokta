//! The user's own `.lrc` files: next to a local music file, or named
//! `Artist - Title.lrc` in Nokta's lyrics folder. They win over LRCLIB and
//! are read again for every track, so a fixed file shows at once.

use std::fs;
use std::path::{Path, PathBuf};

use super::clean::{candidates, normalized};
use super::{lrc, Line};

/// Synced lines from a local file for the track, if there is one.
pub fn find(dir: &Path, track_url: Option<&str>, artist: &str, title: &str) -> Option<Vec<Line>> {
    if let Some(lines) = next_to_song(track_url).and_then(|path| read(&path)) {
        return Some(lines);
    }
    let wanted: Vec<String> = candidates(artist, title)
        .iter()
        .map(|c| normalized(&format!("{} - {}", c.artist, c.title)))
        .collect();
    fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("lrc"))
        })
        .filter(|path| {
            path.file_stem()
                .is_some_and(|stem| wanted.contains(&normalized(&stem.to_string_lossy())))
        })
        .find_map(|path| read(&path))
}

fn next_to_song(track_url: Option<&str>) -> Option<PathBuf> {
    let url = url::Url::parse(track_url?).ok()?;
    if url.scheme() != "file" {
        return None;
    }
    Some(url.to_file_path().ok()?.with_extension("lrc"))
}

fn read(path: &Path) -> Option<Vec<Line>> {
    let lines = lrc::parse(&fs::read_to_string(path).ok()?);
    (!lines.is_empty()).then_some(lines)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    const LRC: &str = "[00:01.00]Satu\n[00:02.50]Dua\n";

    #[test]
    fn a_file_next_to_the_song_is_used() {
        let dir = tempfile::tempdir().unwrap();
        let song = dir.path().join("Lantas.flac");
        fs::write(dir.path().join("Lantas.lrc"), LRC).unwrap();
        let url = url::Url::from_file_path(&song).unwrap().to_string();
        let got = find(
            &dir.path().join("none"),
            Some(&url),
            "Juicy Luicy",
            "Lantas",
        )
        .unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[1].text, "Dua");
    }

    #[test]
    fn the_lyrics_folder_matches_artist_and_title_loosely() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Tulus - Hati-Hati di Jalan.lrc"), LRC).unwrap();
        let got = find(dir.path(), None, "TULUS", "hati hati di jalan");
        assert!(got.is_some());
        // A YouTube title finds it too.
        let got = find(
            dir.path(),
            Some("https://www.youtube.com/watch?v=x"),
            "TULUS Official",
            "TULUS - Hati-Hati di Jalan (Official Music Video)",
        );
        assert!(got.is_some());
        assert!(find(dir.path(), None, "Tulus", "Monokrom").is_none());
    }

    #[test]
    fn files_without_timestamps_or_folders_that_do_not_exist_give_nothing() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("A - B.lrc"), "just words\n").unwrap();
        assert!(find(dir.path(), None, "A", "B").is_none());
        assert!(find(&dir.path().join("missing"), None, "A", "B").is_none());
    }
}
