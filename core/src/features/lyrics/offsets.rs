//! The user's lyric timing per track, kept in `lyrics-offsets.toml`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::Line;

const HEADER: &str = "\
# Lyric timing per song, set from Nokta's lyrics view. Each key is a hash of
# the song's artist, title, album and length; each value is milliseconds,
# positive shows the lyrics earlier. Remove a line to forget it.
";

#[derive(Default, Serialize, Deserialize)]
struct File {
    #[serde(default)]
    offsets: BTreeMap<String, i64>,
}

/// The largest nudge either way, in milliseconds.
pub const MAX_OFFSET_MS: i64 = 30_000;

/// Keeps `offset_ms` within ±`MAX_OFFSET_MS`.
pub fn clamp(offset_ms: i64) -> i64 {
    offset_ms.clamp(-MAX_OFFSET_MS, MAX_OFFSET_MS)
}

/// The lines as shown with `offset_ms`: positive starts each line earlier,
/// never before the start of the track.
pub fn shift(lines: &[Line], offset_ms: i64) -> Vec<Line> {
    let by_us = clamp(offset_ms) * 1_000;
    lines
        .iter()
        .map(|l| Line {
            start_us: l.start_us.saturating_sub(by_us).max(0),
            text: l.text.clone(),
        })
        .collect()
}

/// Offsets by `TrackKey::offset_name`; tracks without one are left out.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Offsets {
    by_track: BTreeMap<String, i64>,
}

impl Offsets {
    /// Reads the file's text; a broken file is an error.
    pub fn parse(text: &str) -> Result<Offsets, toml::de::Error> {
        let file: File = toml::from_str(text)?;
        let by_track = file
            .offsets
            .into_iter()
            .map(|(track, ms)| (track, clamp(ms)))
            .filter(|(_, ms)| *ms != 0)
            .collect();
        Ok(Offsets { by_track })
    }

    /// The file's text, with a comment that says what it is.
    pub fn to_toml(&self) -> String {
        let file = File {
            offsets: self.by_track.clone(),
        };
        let body = toml::to_string(&file).expect("a table of integers is valid TOML");
        format!("{HEADER}{body}")
    }

    pub fn get(&self, track: &str) -> i64 {
        self.by_track.get(track).copied().unwrap_or(0)
    }

    /// Stores the clamped offset and returns it; 0 forgets the track.
    pub fn set(&mut self, track: &str, offset_ms: i64) -> i64 {
        let offset_ms = clamp(offset_ms);
        if offset_ms == 0 {
            self.by_track.remove(track);
        } else {
            self.by_track.insert(track.to_owned(), offset_ms);
        }
        offset_ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(start_us: i64, text: &str) -> Line {
        Line {
            start_us,
            text: text.into(),
        }
    }

    #[test]
    fn clamp_keeps_thirty_seconds_either_way() {
        assert_eq!(clamp(250), 250);
        assert_eq!(clamp(-30_000), -30_000);
        assert_eq!(clamp(30_001), 30_000);
        assert_eq!(clamp(i64::MIN), -30_000);
    }

    #[test]
    fn a_positive_offset_shows_lines_earlier_but_not_before_the_start() {
        let lines = [line(0, "a"), line(1_000_000, "b"), line(5_000_000, "c")];
        assert_eq!(
            shift(&lines, 1_500),
            [line(0, "a"), line(0, "b"), line(3_500_000, "c")]
        );
        assert_eq!(
            shift(&lines, -250),
            [
                line(250_000, "a"),
                line(1_250_000, "b"),
                line(5_250_000, "c")
            ]
        );
        assert_eq!(shift(&lines, 0), lines);
    }

    #[test]
    fn set_clamps_and_zero_forgets_the_track() {
        let mut offsets = Offsets::default();
        assert_eq!(offsets.get("a"), 0);
        assert_eq!(offsets.set("a", 500), 500);
        assert_eq!(offsets.set("b", -99_999), -30_000);
        assert_eq!(offsets.get("a"), 500);
        assert_eq!(offsets.get("b"), -30_000);
        assert_eq!(offsets.set("a", 0), 0);
        assert_eq!(offsets.get("a"), 0);
        assert_eq!(offsets.by_track.len(), 1, "0 removes the entry");
    }

    #[test]
    fn the_file_round_trips_with_a_comment() {
        let mut offsets = Offsets::default();
        offsets.set("abc", 750);
        offsets.set("def", -250);
        let text = offsets.to_toml();
        assert!(text.starts_with("# "), "{text}");
        assert!(text.contains("abc = 750"), "{text}");
        assert_eq!(Offsets::parse(&text).unwrap(), offsets);
    }

    #[test]
    fn an_empty_file_has_no_offsets_and_a_broken_one_is_an_error() {
        assert_eq!(Offsets::parse("").unwrap(), Offsets::default());
        assert_eq!(
            Offsets::parse(&Offsets::default().to_toml()).unwrap(),
            Offsets::default()
        );
        assert!(Offsets::parse("[offsets]\nabc = \"soon\"\n").is_err());
        assert!(Offsets::parse("not toml").is_err());
    }

    #[test]
    fn values_out_of_range_in_the_file_are_clamped() {
        let offsets = Offsets::parse("[offsets]\nabc = 90000\nzero = 0\n").unwrap();
        assert_eq!(offsets.get("abc"), 30_000);
        assert_eq!(offsets.by_track.len(), 1);
    }
}
