//! Turns what a player reports into what LRCLIB knows. Browsers playing
//! YouTube report the video title and the channel, for example
//! `TULUS - Hati-Hati di Jalan (Official Music Video)` by `TULUS Official`,
//! or for a cover `Hati-Hati di Jalan - Tulus (Cover by Tami Aulia)` by
//! `Tami Aulia`: the song can sit on either side of the dash.

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
    "cover",
    "covered",
    "akustik",
    "karaoke",
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

/// The most `(artist, title)` pairs [`candidates`] gives.
pub const MAX_CANDIDATES: usize = 4;

/// Phrases after which a title names who sings the cover, not the song.
const COVER_BY: &[&str] = &[" cover by ", " covered by ", " cover oleh "];

/// Up to [`MAX_CANDIDATES`] `(artist, title)` pairs to search, best first.
pub fn candidates(artist: &str, title: &str) -> Vec<Candidate> {
    let artist_clean = clean_artist(artist);
    let mut out = Vec::new();
    for part in song_parts(title) {
        let cleaned = clean_title(part);
        if normalized(&cleaned).is_empty() {
            continue;
        }
        if let Some((left, right)) = split_dash(&cleaned) {
            push(&mut out, left, right);
            push(&mut out, &artist_clean, &cleaned);
            // A cover often names the song first: `Song - Artist`.
            push(&mut out, right, left);
        } else {
            push(&mut out, &artist_clean, &cleaned);
            // `Sial (Mahalini)`: what is left in brackets is not the song.
            push(&mut out, &artist_clean, &strip_all_brackets(&cleaned));
        }
    }
    if out.is_empty() {
        push(&mut out, &artist_clean, title.trim());
    }
    out.truncate(MAX_CANDIDATES);
    out
}

/// The song titles among `candidates` worth searching without an artist,
/// best first: each once, and not an `Artist - Song` pair.
pub fn song_titles(candidates: &[Candidate]) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for c in candidates {
        let title = c.title.as_str();
        if split_dash(title).is_none() && !out.iter().any(|t| normalized(t) == normalized(title)) {
            out.push(title);
        }
    }
    out
}

/// Whether an LRCLIB record titled `record_title` is the song `song`. Some
/// records carry a whole video title, `TULUS - Hati-Hati di Jalan (Official
/// Music Video)`.
pub fn names_song(record_title: &str, song: &str) -> bool {
    let want = normalized(song);
    if want.is_empty() {
        return false;
    }
    let cleaned = clean_title(record_title);
    normalized(record_title) == want
        || normalized(&cleaned) == want
        || split_dash(&cleaned).is_some_and(|(_, right)| normalized(right) == want)
}

/// Whether `artist` (as LRCLIB names it, maybe `A, B` or `A & B`) is named
/// in `text`, as whole words.
pub fn names_artist(text: &str, artist: &str) -> bool {
    let text = format!(" {} ", normalized(text));
    artist
        .split([',', '&', '/'])
        .flat_map(|a| a.split(" feat"))
        .map(normalized)
        .any(|a| !a.is_empty() && text.contains(&format!(" {a} ")))
}

/// Whether a title says it is someone else singing the song.
pub fn is_cover(title: &str) -> bool {
    words(title)
        .iter()
        .any(|w| ["cover", "covered", "karaoke", "akustik"].contains(&w.as_str()))
}

/// The parts of a `A | B | C` title that may name the song: those with an
/// `Artist - Song` dash first, then the first part.
fn song_parts(title: &str) -> Vec<&str> {
    let parts: Vec<&str> = title
        .split(" | ")
        .flat_map(|p| p.split(" // "))
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    let mut out: Vec<&str> = parts
        .iter()
        .copied()
        .filter(|p| split_dash(p).is_some())
        .collect();
    if let Some(first) = parts.first() {
        if !out.contains(first) {
            out.push(first);
        }
    }
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
    let mut t = strip_brackets(title);
    for marker in [" feat. ", " feat ", " ft. ", " ft ", " featuring "]
        .iter()
        .chain(COVER_BY)
    {
        if let Some(at) = t.to_lowercase().find(marker) {
            t.truncate(at);
        }
    }
    let mut t: Vec<&str> = t
        .split_whitespace()
        .filter(|w| !w.starts_with('#'))
        .collect();
    // `Sial Cover`, `Sial Akustik Cover`
    while t.len() > 1
        && ["cover", "akustik", "acoustic"].contains(&normalized(t[t.len() - 1]).as_str())
    {
        t.pop();
    }
    let mut t = t.join(" ");
    if let Some((left, right)) = split_dash(&t) {
        let right_words = words(right);
        let decoration = |w: &String| NOISE.contains(&w.as_str()) || VERSIONS.contains(&w.as_str());
        // `Cover Me` is a song; `Cover` and `Akustik Cover` are not.
        if right_words
            .first()
            .is_some_and(|w| VERSIONS.contains(&w.as_str()))
            || right_words.iter().all(decoration)
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

/// The title without any bracketed part.
fn strip_all_brackets(title: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    for c in title.chars() {
        match c {
            '(' | '[' | '【' => depth += 1,
            ')' | ']' | '】' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
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
        assert!(got.len() <= MAX_CANDIDATES);
    }

    #[test]
    fn a_cover_is_asked_as_the_song_it_covers() {
        let got = pairs(
            "Tami Aulia",
            "Hati-Hati di Jalan - Tulus (Cover by Tami Aulia)",
        );
        // Either side of the dash can be the artist.
        assert!(
            got.contains(&pair("Tulus", "Hati-Hati di Jalan")),
            "{got:?}"
        );
        assert!(
            got.contains(&pair("Hati-Hati di Jalan", "Tulus")),
            "{got:?}"
        );
        assert_eq!(
            pairs("Nabila Maharani", "Mahalini - Sial (Acoustic Cover)")[0],
            pair("Mahalini", "Sial")
        );
        assert_eq!(
            pairs(
                "Nabila Maharani",
                "Mahalini - Sial Cover by Nabila Maharani"
            )[0],
            pair("Mahalini", "Sial")
        );
        assert_eq!(
            pairs("Nabila Maharani", "Sial - Cover")[0],
            pair("Nabila Maharani", "Sial")
        );
    }

    #[test]
    fn the_part_of_a_piped_title_that_names_the_song_is_used() {
        let got = pairs("Tami Aulia", "TAMI AULIA | HATI-HATI DI JALAN - TULUS");
        assert_eq!(got[0], pair("HATI-HATI DI JALAN", "TULUS"));
        assert!(
            got.contains(&pair("TULUS", "HATI-HATI DI JALAN")),
            "{got:?}"
        );
        let got = pairs("Nabila Maharani", "Sial (Mahalini) | Cover Lagu");
        assert!(
            got.iter().any(|(_, title)| title == "Sial"),
            "the song without the artist in brackets: {got:?}"
        );
    }

    #[test]
    fn a_song_named_cover_keeps_its_name() {
        assert_eq!(
            pairs("Bruce Springsteen", "Cover Me")[0],
            pair("Bruce Springsteen", "Cover Me")
        );
        assert_eq!(
            pairs("Channel", "Bruce Springsteen - Cover Me")[0],
            pair("Bruce Springsteen", "Cover Me")
        );
    }

    #[test]
    fn song_titles_are_each_side_of_the_dash_once() {
        let c = candidates(
            "Tami Aulia",
            "Hati-Hati di Jalan - Tulus (Cover by Tami Aulia)",
        );
        assert_eq!(song_titles(&c), ["Tulus", "Hati-Hati di Jalan"]);
        assert_eq!(
            song_titles(&candidates("Daft Punk", "Get Lucky")),
            ["Get Lucky"]
        );
    }

    #[test]
    fn a_record_with_a_video_title_names_the_song() {
        let video = "TULUS - Hati-Hati di Jalan (Official Music Video)";
        assert!(names_song(video, "Hati-Hati di Jalan"));
        assert!(names_song("Hati‐Hati di Jalan", "hati-hati di jalan"));
        assert!(!names_song(video, "Tulus"));
        assert!(!names_song("Get Lucky Tonight", "Get Lucky"));
        assert!(!names_song("Sial", ""));
    }

    #[test]
    fn an_artist_is_named_as_whole_words() {
        let title = "Hati-Hati di Jalan - Tulus (Cover by Tami Aulia)";
        assert!(names_artist(title, "Tulus"));
        assert!(names_artist(title, "Song, Tulus"));
        assert!(!names_artist(title, "Radja"));
        assert!(!names_artist("Tulusan", "Tulus"));
        assert!(!names_artist(title, ""));
    }

    #[test]
    fn a_cover_says_so() {
        assert!(is_cover("Sial (Cover)"));
        assert!(is_cover("Hati-Hati di Jalan - Tulus | Akustik"));
        assert!(!is_cover("Get Lucky"));
        assert!(!is_cover("Coverage"));
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
