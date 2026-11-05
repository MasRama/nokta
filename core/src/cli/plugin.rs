//! What `nokta plugin list` prints.

/// An installed plugin as `Plugins1.Plugins` lists it: id, on, status, why
/// it failed, and its manifest as JSON.
pub type PluginRow = (String, bool, String, String, String);

/// One line per plugin: its id, on or off, what it is doing, its name and
/// why it failed.
pub fn table(rows: &[PluginRow]) -> String {
    if rows.is_empty() {
        return "No plugins. Add one with: nokta plugin install FOLDER\n".into();
    }
    let width = rows.iter().map(|row| row.0.len()).max().unwrap_or(0);
    let mut text = String::new();
    for (id, enabled, status, message, info) in rows {
        let name = serde_json::from_str::<serde_json::Value>(info)
            .ok()
            .and_then(|info| info.get("name")?.as_str().map(str::to_owned))
            .unwrap_or_default();
        let on = if *enabled { "on" } else { "off" };
        let about = match (name.is_empty(), message.is_empty()) {
            (_, true) => name,
            (true, false) => message.clone(),
            (false, false) => format!("{name} — {message}"),
        };
        let line = format!("{id:<width$}  {on:<3}  {status:<11}  {about}");
        text.push_str(line.trim_end());
        text.push('\n');
    }
    text
}
