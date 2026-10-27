//! Turns what a player reports into what LRCLIB knows. Browsers playing
//! YouTube report the video title and the channel, for example
//! `TULUS - Hati-Hati di Jalan (Official Music Video)` by `TULUS Official`.

/// One way to ask LRCLIB for the playing track.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub artist: String,
    pub title: String,
}

/// Words that mark a bracketed part of a title as decoration.
const NOISE: &[&str] = &[
    "official",
    "video",
    "audio",
    "lyric",
    "lyrics",
    "lirik",
    "mv",
    "visualizer",
    "visualiser",
    "hd",
    "hq",
    "4k",
    "clip",
    "klip",
    "feat",
    "ft",
    "featuring",
    "remaster",
    "remastered",
    "live",
    "acoustic",
    "version",
    "explicit",
];

/// Words after a dash that name a version rather than another song.
const VERSIONS: &[&str] = &[
    "remaster",
    "remastered",
    "live",
    "edit",
    "radio",
    "version",
    "mix",
    "remix",
    "acoustic",
    "mono",
    "stereo",
    "single",
    "original",
    "from",
];

/// Channel words that are not part of an artist's name.
const CHANNEL: &[&str] = &["official", "music", "channel", "tv", "ofc"];

/// Up to three `(artist, title)` pairs to search, best first.
pub fn candidates(artist: &str, title: &str) -> Vec<Candidate> {
    let artist_clean = clean_artist(artist);
    let mut title_clean = clean_title(title);
    if normalized(&title_clean).is_empty() {
        title_clean = title.trim().to_owned();
    }
    let mut out = Vec::new();
    if let Some((left, right)) = split_dash(&title_clean) {
        push(&mut out, left, right);
    }
    push(&mut out, &artist_clean, &title_clean);
    out.truncate(3);
    out
}

fn push(out: &mut Vec<Candidate>, artist: &str, title: &str) {
    let candidate = Candidate {
        artist: artist.trim().to_owned(),
        title: title.trim().to_owned(),
    };
    let same = |c: &Candidate| {
        normalized(&c.artist) == normalized(&candidate.artist)
            && normalized(&c.title) == normalized(&candidate.title)
    };
    if !candidate.title.is_empty() && !out.iter().any(same) {
        out.push(candidate);
    }
}

/// Lower case letters and digits, every other run of characters one space.
pub fn normalized(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim_end().to_owned()
}

fn words(s: &str) -> Vec<String> {
    normalized(s).split(' ').map(str::to_owned).collect()
}

fn clean_artist(artist: &str) -> String {
    let mut a = artist.trim().to_owned();
    for suffix in [" - Topic", "VEVO"] {
        if a.len() > suffix.len() && a.to_lowercase().ends_with(&suffix.to_lowercase()) {
            a.truncate(a.len() - suffix.len());
        }
    }
    let mut parts: Vec<&str> = a.split_whitespace().collect();
    while parts.len() > 1 && CHANNEL.contains(&parts[parts.len() - 1].to_lowercase().as_str()) {
        parts.pop();
    }
    parts.join(" ")
}

fn clean_title(title: &str) -> String {
    let mut t = title.split(" | ").next().unwrap_or_default().to_owned();
    t = strip_brackets(&t);
    for marker in [" feat. ", " feat ", " ft. ", " ft ", " featuring "] {
        if let Some(at) = t.to_lowercase().find(marker) {
            t.truncate(at);
        }
    }
    let t: Vec<&str> = t
        .split_whitespace()
        .filter(|w| !w.starts_with('#'))
        .collect();
    let mut t = t.join(" ");
    if let Some((left, right)) = split_dash(&t) {
        if words(right)
            .first()
            .is_some_and(|w| VERSIONS.contains(&w.as_str()))
        {
            t = left.to_owned();
        }
    }
    t.trim_matches(|c: char| c.is_whitespace() || c == '-')
        .to_owned()
}

/// Removes `(...)`, `[...]` and `【...】` parts that hold a noise word.
fn strip_brackets(title: &str) -> String {
    let mut out = String::new();
    let mut rest = title;
    while let Some(open) = rest.find(['(', '[', '【']) {
        let close = match rest[open..].chars().next() {
            Some('(') => ')',
            Some('[') => ']',
            _ => '】',
        };
        let Some(len) = rest[open..].find(close) else {
            break;
        };
        let inside = &rest[open + 1..open + len];
        out.push_str(&rest[..open]);
        if !words(inside).iter().any(|w| NOISE.contains(&w.as_str())) {
            out.push_str(&rest[open..open + len + close.len_utf8()]);
        }
        rest = &rest[open + len + close.len_utf8()..];
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `Left - Right` split at the first spaced dash, both sides non-empty.
fn split_dash(title: &str) -> Option<(&str, &str)> {
    [" - ", " – ", " — "].iter().find_map(|dash| {
        let (left, right) = title.split_once(dash)?;
        let (left, right) = (left.trim(), right.trim());
        (!left.is_empty() && !right.is_empty()).then_some((left, right))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(artist: &str, title: &str) -> Vec<(String, String)> {
        candidates(artist, title)
            .into_iter()
            .map(|c| (c.artist, c.title))
            .collect()
    }

    fn pair(artist: &str, title: &str) -> (String, String) {
        (artist.to_owned(), title.to_owned())
    }

    #[test]
    fn a_clean_track_is_asked_as_it_is() {
        assert_eq!(
            pairs("Daft Punk", "Get Lucky"),
            [pair("Daft Punk", "Get Lucky")]
        );
        // A hyphen inside a word is not a separator.
        assert_eq!(
            pairs("Tulus", "Hati-Hati di Jalan"),
            [pair("Tulus", "Hati-Hati di Jalan")]
        );
    }

    #[test]
    fn youtube_video_titles_lose_their_decorations() {
        assert_eq!(
            pairs(
                "TULUS Official",
                "TULUS - Hati-Hati di Jalan (Official Music Video)"
            )[0],
            pair("TULUS", "Hati-Hati di Jalan")
        );
        assert_eq!(
            pairs(
                "Nadin Amizah",
                "Nadin Amizah - Bertaut (Official Lyric Video)"
            )[0],
            pair("Nadin Amizah", "Bertaut")
        );
        assert_eq!(
            pairs("Hindia", "Hindia - Secukupnya [Lirik]")[0],
            pair("Hindia", "Secukupnya")
        );
        assert_eq!(
            pairs(
                "Bernadya",
                "Bernadya - Satu Bulan (Official Music Video) | 4K"
            )[0],
            pair("Bernadya", "Satu Bulan")
        );
        assert_eq!(
            pairs("Mahalini - Topic", "Sial")[0],
            pair("Mahalini", "Sial")
        );
        assert_eq!(
            pairs("NOAHVEVO", "NOAH - Separuh Aku (Official Audio)")[0],
            pair("NOAH", "Separuh Aku")
        );
    }

    #[test]
    fn a_channel_that_is_not_the_artist_still_finds_the_artist_in_the_title() {
        assert_eq!(
            pairs("Musik Indo Terbaru", "Juicy Luicy - Lantas (Lirik)")[0],
            pair("Juicy Luicy", "Lantas")
        );
    }

    #[test]
    fn featured_artists_and_versions_are_dropped() {
        assert_eq!(
            pairs("Rizky Febian", "Kesempurnaan Cinta (feat. Mahalini)")[0],
            pair("Rizky Febian", "Kesempurnaan Cinta")
        );
        assert_eq!(
            pairs("Queen", "Bohemian Rhapsody - Remastered 2011"),
            [pair("Queen", "Bohemian Rhapsody")]
        );
        assert_eq!(
            pairs("Dewa 19", "Kangen - Live"),
            [pair("Dewa 19", "Kangen")]
        );
    }

    #[test]
    fn the_title_as_given_is_also_tried() {
        let got = pairs("Lagu Hits", "Artist - Song (Official Video)");
        assert_eq!(got[0], pair("Artist", "Song"));
        assert!(got.contains(&pair("Lagu Hits", "Artist - Song")), "{got:?}");
        assert!(got.len() <= 3);
    }

    #[test]
    fn nothing_left_means_the_original() {
        assert_eq!(
            pairs("", "(Official Video)"),
            [pair("", "(Official Video)")]
        );
    }

    #[test]
    fn normalized_ignores_case_punctuation_and_dashes() {
        assert_eq!(
            normalized("Hati‐Hati di  Jalan"),
            normalized("hati-hati di jalan")
        );
        assert_eq!(normalized("Dan..."), normalized("dan"));
        assert_eq!(normalized("TULUS"), "tulus");
    }
}
