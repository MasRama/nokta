//! Feature `plugins`: add-on plugins. Each is a folder with a `plugin.toml`
//! and a program in any language, which noktad runs out of process as the
//! user; what it prints, one JSON object, becomes a card the notch draws
//! with its own parts, the same on every system.

pub mod card;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod install;
pub mod manifest;
pub mod runner;
pub mod saved;
pub mod service;
mod watch;

#[cfg(test)]
mod tests;

/// One installed plugin, as `io.nokta.Plugins1` lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct PluginRow {
    pub id: String,
    pub enabled: bool,
    /// `off`, `running` (started, nothing printed yet), `ok`, `error`,
    /// `broken` (its plugin.toml) or `unsupported` (no command for this system).
    pub status: String,
    /// Why it failed or is broken.
    pub message: String,
    /// Its manifest and option values, as JSON for the settings window.
    pub info: String,
}

/// What the plugins publish.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PluginsState {
    pub plugins: Vec<PluginRow>,
    /// Each running plugin's card that has something to show, as JSON, by id.
    pub cards: Vec<(String, String)>,
}

/// An alert a plugin asked for; it shows once.
#[derive(Clone, Debug, PartialEq)]
pub struct PluginAlert {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub icon: String,
    pub tone: String,
    pub important: bool,
}
