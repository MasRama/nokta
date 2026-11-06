//! The lyrics the user picked per track, kept in `lyrics-choices.toml`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

const HEADER: &str = "\
# Lyrics picked per song from Nokta's lyrics view. Each key is a hash of the
# song's artist, title, album and length; each value is the LRCLIB record
# shown for it. Remove a line to go back to the lyrics Nokta finds itself.
";

#[derive(Default, Serialize, Deserialize)]
struct File {
    #[serde(default)]
    choices: BTreeMap<String, i64>,
}

/// LRCLIB record ids by `TrackKey::offset_name`; tracks Nokta finds lyrics
/// for itself are left out.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Choices {
    by_track: BTreeMap<String, i64>,
}

impl Choices {
    /// Reads the file's text; a broken file is an error.
    pub fn parse(text: &str) -> Result<Choices, toml::de::Error> {
        let file: File = toml::from_str(text)?;
        let by_track = file.choices.into_iter().filter(|(_, id)| *id > 0).collect();
        Ok(Choices { by_track })
    }

    /// The file's text, with a comment that says what it is.
    pub fn to_toml(&self) -> String {
        let file = File {
            choices: self.by_track.clone(),
        };
        let body = toml::to_string(&file).expect("a table of integers is valid TOML");
        format!("{HEADER}{body}")
    }

    /// The record picked for the track, 0 when Nokta finds the lyrics itself.
    pub fn get(&self, track: &str) -> i64 {
        self.by_track.get(track).copied().unwrap_or(0)
    }

    /// Picks the record for the track and returns its id; 0 or less forgets
    /// the pick and returns 0.
    pub fn set(&mut self, track: &str, id: i64) -> i64 {
        if id > 0 {
            self.by_track.insert(track.to_owned(), id);
            id
        } else {
            self.by_track.remove(track);
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_keeps_a_pick_and_zero_or_less_forgets_it() {
        let mut choices = Choices::default();
        assert_eq!(choices.get("a"), 0);
        assert_eq!(choices.set("a", 42), 42);
        assert_eq!(choices.set("b", 7), 7);
        assert_eq!(choices.get("a"), 42);
        assert_eq!(choices.set("a", 0), 0);
        assert_eq!(choices.set("b", -1), 0);
        assert_eq!(choices, Choices::default());
    }

    #[test]
    fn the_file_round_trips_with_a_comment() {
        let mut choices = Choices::default();
        choices.set("abc", 12);
        let text = choices.to_toml();
        assert!(text.starts_with("# "), "{text}");
        assert!(text.contains("abc = 12"), "{text}");
        assert_eq!(Choices::parse(&text).unwrap(), choices);
    }

    #[test]
    fn an_empty_file_has_no_picks_a_broken_one_is_an_error_and_bad_ids_are_dropped() {
        assert_eq!(Choices::parse("").unwrap(), Choices::default());
        assert!(Choices::parse("not toml").is_err());
        assert!(Choices::parse("[choices]\nabc = \"x\"\n").is_err());
        let choices = Choices::parse("[choices]\nabc = 0\ndef = -3\nghi = 5\n").unwrap();
        assert_eq!(choices.by_track.len(), 1);
        assert_eq!(choices.get("ghi"), 5);
    }
}
