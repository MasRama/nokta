//! An app's name and icon from its desktop entry.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct App {
    pub name: String,
    /// A themed icon name; empty when the entry has none or names a file.
    pub icon: String,
}

/// The `[Desktop Entry]` group's unlocalized `Name` and its `Icon` if it is a name.
pub fn parse_entry(text: &str) -> Option<(String, String)> {
    let mut in_entry = false;
    let (mut name, mut icon) = (None, String::new());
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        if let Some(value) = line.strip_prefix("Name=") {
            name = Some(value.trim().to_owned());
        } else if let Some(value) = line.strip_prefix("Icon=") {
            let value = value.trim();
            if !value.contains('/') {
                value.clone_into(&mut icon);
            }
        }
    }
    name.filter(|n| !n.is_empty()).map(|n| (n, icon))
}

/// The app `id` (like `firefox.desktop`) from the first `<dir>/applications`
/// that has it; its id without `.desktop` when none does.
pub fn app_for(id: &str, dirs: &[PathBuf]) -> App {
    let found = dirs.iter().find_map(|dir| {
        let text = std::fs::read_to_string(dir.join("applications").join(id)).ok()?;
        parse_entry(&text)
    });
    match found {
        Some((name, icon)) => App { name, icon },
        None => App {
            name: id.strip_suffix(".desktop").unwrap_or(id).to_owned(),
            icon: String::new(),
        },
    }
}

/// `$XDG_DATA_HOME`, then `$XDG_DATA_DIRS`, with their defaults.
pub fn data_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join(".local/share")));
    let system = std::env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    home.into_iter()
        .chain(
            system
                .split(':')
                .filter(|d| !d.is_empty())
                .map(PathBuf::from),
        )
        .collect()
}
