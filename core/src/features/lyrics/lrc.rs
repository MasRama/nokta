//! Parser for LRC synced lyrics, as returned by LRCLIB in `syncedLyrics`.

use super::Line;

/// Parses LRC text into lines sorted by start time. A line with several timestamps yields one
/// [`Line`] per timestamp. `[offset:+N]` (milliseconds) makes every line start N ms earlier.
/// Metadata tags and lines without a timestamp are skipped; empty lyric lines are kept.
pub fn parse(text: &str) -> Vec<Line> {
    let mut offset_ms: i64 = 0;
    let mut lines = Vec::new();
    for raw in text.lines() {
        let mut rest = raw.trim_end_matches('\r').trim_start();
        let mut starts = Vec::new();
        while let Some(tag_end) = rest.strip_prefix('[').and_then(|r| r.find(']')) {
            let tag = &rest[1..=tag_end];
            if let Some(us) = parse_timestamp(tag) {
                starts.push(us);
            } else if let Some(value) = tag.strip_prefix("offset:") {
                if let Ok(ms) = value.trim().parse::<i64>() {
                    offset_ms = ms;
                }
            } else {
                break;
            }
            rest = &rest[tag_end + 2..];
        }
        let text = rest.trim();
        lines.extend(starts.into_iter().map(|start_us| Line {
            start_us,
            text: text.to_owned(),
        }));
    }
    for line in &mut lines {
        line.start_us = (line.start_us - offset_ms * 1_000).max(0);
    }
    lines.sort_by_key(|l| l.start_us);
    lines
}

/// `mm:ss`, `mm:ss.f`, `mm:ss.ff` or `mm:ss.fff` to microseconds.
fn parse_timestamp(tag: &str) -> Option<i64> {
    let (minutes, seconds) = tag.split_once(':')?;
    let minutes: i64 = digits(minutes)?;
    let (whole, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
    let whole: i64 = digits(whole)?;
    if whole >= 60 {
        return None;
    }
    let fraction_us = match fraction.len() {
        0 => 0,
        1..=3 => digits(fraction)? * 10_i64.pow(6 - fraction.len() as u32),
        _ => return None,
    };
    Some((minutes * 60 + whole) * 1_000_000 + fraction_us)
}

fn digits(s: &str) -> Option<i64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
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
    fn parses_basic_lines() {
        assert_eq!(
            parse("[00:31.48] Like the legend of the phoenix\n[00:35.40] All ends"),
            [
                line(31_480_000, "Like the legend of the phoenix"),
                line(35_400_000, "All ends")
            ]
        );
    }

    #[test]
    fn parses_three_digit_fraction() {
        assert_eq!(parse("[01:02.345]x"), [line(62_345_000, "x")]);
    }

    #[test]
    fn parses_without_fraction() {
        assert_eq!(parse("[00:05]x"), [line(5_000_000, "x")]);
    }

    #[test]
    fn multiple_timestamps_per_line() {
        assert_eq!(
            parse("[00:01.00][00:10.00]chorus"),
            [line(1_000_000, "chorus"), line(10_000_000, "chorus")]
        );
    }

    #[test]
    fn offset_shifts_earlier() {
        assert_eq!(parse("[offset:+500]\n[00:01.00]a"), [line(500_000, "a")]);
    }

    #[test]
    fn negative_offset_shifts_later() {
        assert_eq!(parse("[offset:-250]\n[00:01.00]a"), [line(1_250_000, "a")]);
    }

    #[test]
    fn offset_clamps_at_zero() {
        assert_eq!(parse("[offset:2000]\n[00:01.00]a"), [line(0, "a")]);
    }

    #[test]
    fn skips_metadata_and_garbage() {
        let text = "[ar:Daft Punk]\n[ti:Get Lucky]\nnot a lyric\n[xx:yy]z\n[00:02.00]ok";
        assert_eq!(parse(text), [line(2_000_000, "ok")]);
    }

    #[test]
    fn output_is_sorted() {
        assert_eq!(
            parse("[00:09.00]b\n[00:01.00]a"),
            [line(1_000_000, "a"), line(9_000_000, "b")]
        );
    }

    #[test]
    fn keeps_empty_lines() {
        assert_eq!(
            parse("[00:01.00]a\n[00:04.00]\n[00:08.00]b"),
            [
                line(1_000_000, "a"),
                line(4_000_000, ""),
                line(8_000_000, "b")
            ]
        );
    }

    #[test]
    fn handles_crlf() {
        assert_eq!(
            parse("[00:01.00]a\r\n[00:02.00]b\r\n"),
            [line(1_000_000, "a"), line(2_000_000, "b")]
        );
    }
}
