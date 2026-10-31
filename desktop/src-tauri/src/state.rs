//! What the app keeps between starts that is not a setting, in
//! `state.toml` next to config.toml: for now whether the first-run tour
//! ended once, as the extension's `tour-shown` GSettings key. Pure, so it is
//! tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

use toml_edit::{value, DocumentMut};

/// The key of the tour having ended once.
const TOUR_SHOWN: &str = "tour-shown";

/// Whether `text` says the tour ended once; a file that does not read says no.
pub fn tour_shown(text: &str) -> bool {
    text.parse::<DocumentMut>()
        .ok()
        .and_then(|doc| doc.get(TOUR_SHOWN)?.as_bool())
        .unwrap_or(false)
}

/// `text` with the tour `shown` or not, its other keys and comments kept; a
/// file that does not read is started over.
pub fn with_tour_shown(text: &str, shown: bool) -> String {
    let mut doc = text.parse::<DocumentMut>().unwrap_or_default();
    doc[TOUR_SHOWN] = value(shown);
    doc.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tour_shows_until_it_ended_once() {
        assert!(!tour_shown(""));
        assert!(tour_shown(&with_tour_shown("", true)));
        assert!(!tour_shown(&with_tour_shown("tour-shown = true\n", false)));
    }

    #[test]
    fn other_keys_and_comments_stay() {
        let text = with_tour_shown("# Nokta's own\nother = 1\n", true);
        assert_eq!(text, "# Nokta's own\nother = 1\ntour-shown = true\n");
    }

    #[test]
    fn a_broken_file_shows_the_tour_and_is_started_over() {
        assert!(!tour_shown("tour-shown = ["));
        assert!(!tour_shown("tour-shown = \"yes\""));
        assert_eq!(
            with_tour_shown("tour-shown = [", true),
            "tour-shown = true\n"
        );
    }
}
