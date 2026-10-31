//! Finds a meeting link in an event's iCalendar text.

use url::Url;

/// Where a link is looked for, in this order; the first property with an
/// accepted link wins.
const PROPERTIES: [&str; 5] = [
    "X-GOOGLE-CONFERENCE",
    "CONFERENCE",
    "URL",
    "LOCATION",
    "DESCRIPTION",
];

/// `"<source uid>\n<event uid>\n<recurrence id>"`, the shell's event id,
/// as its three parts; the recurrence id may be empty.
pub fn split_event_id(id: &str) -> Option<(String, String, String)> {
    let mut parts = id.splitn(3, '\n');
    let source = parts.next().filter(|s| !s.is_empty())?;
    let uid = parts.next().filter(|s| !s.is_empty())?;
    let rid = parts.next()?;
    Some((source.to_owned(), uid.to_owned(), rid.to_owned()))
}

/// The first meeting link in `ics`, by property, then by position.
pub fn meeting_link(ics: &str) -> Option<String> {
    let lines = unfold(ics);
    PROPERTIES.iter().find_map(|wanted| {
        lines
            .iter()
            .filter_map(|line| property(line))
            .filter(|(name, _)| name.eq_ignore_ascii_case(wanted))
            .find_map(|(_, value)| {
                let text = unescape(value);
                let found = links(&text).find(|l| is_meeting(l)).map(str::to_owned);
                found
            })
    })
}

/// Content lines with their folds (a line break, then a space or a tab) joined.
pub(super) fn unfold(ics: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in ics.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        match (raw.strip_prefix([' ', '\t']), lines.last_mut()) {
            (Some(rest), Some(last)) => last.push_str(rest),
            _ => lines.push(raw.to_owned()),
        }
    }
    lines
}

/// A content line's name and value; the value starts after the first colon
/// outside a quoted parameter.
fn property(line: &str) -> Option<(&str, &str)> {
    let name_end = line.find([';', ':'])?;
    let mut quoted = false;
    for (i, c) in line.char_indices().skip(name_end) {
        match c {
            '"' => quoted = !quoted,
            ':' if !quoted => return Some((&line[..name_end], &line[i + 1..])),
            _ => {}
        }
    }
    None
}

/// A text value with `\n`, `\,`, `\;` and `\\` undone.
pub(super) fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => out.push('\n'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

/// The `https://` links in `text`, without the punctuation that ends a sentence.
fn links(text: &str) -> impl Iterator<Item = &str> {
    text.match_indices("https://").map(move |(start, _)| {
        let rest = &text[start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\''))
            .unwrap_or(rest.len());
        rest[..end].trim_end_matches(['.', ',', ';', ':', ')', '!', '?'])
    })
}

/// Whether `link` opens a meeting on a service the notch knows.
fn is_meeting(link: &str) -> bool {
    let Ok(url) = Url::parse(link) else {
        return false;
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let path = url.path();
    let under = |domain: &str| host == domain || host.ends_with(&format!(".{domain}"));
    match host {
        "meet.google.com" | "meet.jit.si" | "whereby.com" => true,
        "teams.microsoft.com" => path.starts_with("/l/meetup-join/"),
        "teams.live.com" => path.starts_with("/meet/"),
        _ if under("zoom.us") => ["/j/", "/my/", "/w/"].iter().any(|p| path.starts_with(p)),
        _ => host.ends_with(".webex.com"),
    }
}
