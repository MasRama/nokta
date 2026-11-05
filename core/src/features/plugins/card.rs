//! What a plugin prints: one JSON object, read into a [`Card`] the notch
//! can draw. Pure. Unknown fields are ignored, so a plugin written for a
//! newer Nokta still shows what this one knows; values that do not fit are
//! dropped or cut, never passed on.

use serde::Serialize;
use serde_json::{Map, Value};

use super::manifest::valid_icon;

pub const MAX_ITEMS: usize = 8;
pub const MAX_ACTIONS: usize = 2;
/// The tones a plugin may pick; the notch has a color for each.
pub const TONES: [&str; 11] = [
    "red", "orange", "amber", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "gray",
];

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Card {
    pub title: String,
    pub detail: String,
    pub icon: String,
    pub tone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    /// A few characters for the closed notch; empty keeps the plugin out of it.
    pub badge: String,
    pub items: Vec<Item>,
    pub actions: Vec<Action>,
    /// Shown once, as an alert; not part of what the notch keeps.
    #[serde(skip)]
    pub alert: Option<Alert>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Item {
    pub title: String,
    pub detail: String,
    pub icon: String,
    /// An http(s) address the row opens; empty for none.
    pub open: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Action {
    pub label: String,
    /// An http(s) address to open, or empty.
    pub open: String,
    /// The action the plugin runs with, or empty.
    pub run: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Alert {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub important: bool,
}

impl Card {
    /// Whether the notch has anything to show for it.
    pub fn shows(&self) -> bool {
        !self.title.is_empty() || !self.badge.is_empty()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a card always serializes")
    }
}

/// `text` cut to `max` characters, control characters made spaces, trimmed.
fn clean(text: &str, max: usize) -> String {
    let text: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let cut: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

fn text(map: &Map<String, Value>, key: &str, max: usize) -> String {
    match map.get(key) {
        Some(Value::String(s)) => clean(s, max),
        Some(Value::Number(n)) => clean(&n.to_string(), max),
        _ => String::new(),
    }
}

fn icon(map: &Map<String, Value>) -> String {
    let icon = text(map, "icon", 64);
    if valid_icon(&icon) {
        icon
    } else {
        String::new()
    }
}

/// An address the notch may open: http(s) only, never a file or a program.
pub fn link(map: &Map<String, Value>, key: &str) -> String {
    let address = text(map, key, 2048);
    match url::Url::parse(&address) {
        Ok(url) if matches!(url.scheme(), "http" | "https") && url.host().is_some() => address,
        _ => String::new(),
    }
}

/// An action name the plugin gets back in NOKTA_ACTION.
fn action_name(map: &Map<String, Value>) -> String {
    let name = text(map, "run", 32);
    let ok = name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        name
    } else {
        String::new()
    }
}

/// Reads what the plugin printed: the whole of it as one object, else its
/// last line that is one.
pub fn parse(output: &str) -> Result<Card, String> {
    let object = match serde_json::from_str::<Value>(output.trim()) {
        Ok(Value::Object(map)) => map,
        _ => output
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .find_map(|line| match serde_json::from_str::<Value>(line.trim()) {
                Ok(Value::Object(map)) => Some(map),
                _ => None,
            })
            .ok_or_else(|| {
                if output.trim().is_empty() {
                    "printed nothing".to_owned()
                } else {
                    "did not print a JSON object".to_owned()
                }
            })?,
    };
    Ok(read(&object))
}

fn read(map: &Map<String, Value>) -> Card {
    let alert = match map.get("alert") {
        Some(Value::Object(a)) => {
            let title = text(a, "title", 60);
            let id = match text(a, "id", 64) {
                id if id.is_empty() => title.clone(),
                id => id,
            };
            (!title.is_empty()).then(|| Alert {
                id,
                title,
                detail: text(a, "detail", 80),
                important: a.get("important") == Some(&Value::Bool(true)),
            })
        }
        _ => None,
    };
    if map.get("hidden") == Some(&Value::Bool(true)) {
        return Card {
            alert,
            ..Card::default()
        };
    }
    let tone = text(map, "tone", 16);
    let progress = map
        .get("progress")
        .and_then(Value::as_f64)
        .filter(|p| p.is_finite())
        .map(|p| p.clamp(0.0, 1.0));
    let items = match map.get("items") {
        Some(Value::Array(list)) => list
            .iter()
            .filter_map(Value::as_object)
            .map(|item| Item {
                title: text(item, "title", 80),
                detail: text(item, "detail", 120),
                icon: icon(item),
                open: link(item, "open"),
            })
            .filter(|item| !item.title.is_empty())
            .take(MAX_ITEMS)
            .collect(),
        _ => Vec::new(),
    };
    let actions =
        match map.get("actions") {
            Some(Value::Array(list)) => {
                list.iter()
                    .filter_map(Value::as_object)
                    .filter_map(|action| {
                        let label = text(action, "label", 24);
                        let open = link(action, "open");
                        let run = if open.is_empty() {
                            action_name(action)
                        } else {
                            String::new()
                        };
                        (!label.is_empty() && (!open.is_empty() || !run.is_empty()))
                            .then_some(Action { label, open, run })
                    })
                    .take(MAX_ACTIONS)
                    .collect()
            }
            _ => Vec::new(),
        };
    Card {
        title: text(map, "title", 80),
        detail: text(map, "detail", 120),
        icon: icon(map),
        tone: if TONES.contains(&tone.as_str()) {
            tone
        } else {
            String::new()
        },
        progress,
        badge: text(map, "badge", 8),
        items,
        actions,
        alert,
    }
}
