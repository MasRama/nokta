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

/// One line per catalog plugin: its id, version, name, and whether it is
/// installed, has an update or does not run here. `catalog` is the JSON
/// `Plugins1.Catalog` gives.
pub fn catalog_table(catalog: &str, installed: &[PluginRow]) -> String {
    let listings: Vec<serde_json::Value> = serde_json::from_str(catalog).unwrap_or_default();
    if listings.is_empty() {
        return "The catalog has no plugins yet.\n".into();
    }
    let text = |v: &serde_json::Value, key: &str| v[key].as_str().unwrap_or_default().to_owned();
    let version_of = |id: &str| {
        installed.iter().find(|row| row.0 == id).map(|row| {
            serde_json::from_str::<serde_json::Value>(&row.4)
                .map(|info| text(&info, "version"))
                .unwrap_or_default()
        })
    };
    let id_width = listings
        .iter()
        .map(|l| text(l, "id").len())
        .max()
        .unwrap_or(0);
    let version_width = listings
        .iter()
        .map(|l| text(l, "version").len())
        .max()
        .unwrap_or(0);
    let mut out = String::new();
    for listing in &listings {
        let (id, version) = (text(listing, "id"), text(listing, "version"));
        let state = match version_of(&id) {
            Some(have) if newer(&have, &version) => format!("update from {have}"),
            Some(_) => "installed".to_owned(),
            None if listing["runs_here"] == false => "not for this system".to_owned(),
            None => String::new(),
        };
        let name = text(listing, "name");
        let line = format!("{id:<id_width$}  {version:<version_width$}  {name}  {state}");
        out.push_str(line.trim_end());
        out.push('\n');
    }
    out.push_str("Install one with: nokta plugin install ID\n");
    out
}

/// Whether `available` is a newer version than `installed`: dotted numbers
/// compared one by one, anything after them ignored.
pub fn newer(installed: &str, available: &str) -> bool {
    let numbers = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split(['-', '+'])
            .next()
            .unwrap_or_default()
            .split('.')
            .map(|n| n.parse().unwrap_or(0))
            .collect()
    };
    let (a, b) = (numbers(installed), numbers(available));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(i).copied().unwrap_or(0),
            b.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return y > x;
        }
    }
    false
}
