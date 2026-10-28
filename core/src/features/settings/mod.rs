//! Feature `settings`: config.toml loading, validation, hot reload.

mod config;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod edit;
pub mod service;
mod store;
mod watch;

pub use config::{
    parse, ActivitiesConfig, Appearance, Behavior, CalendarConfig, ClipboardConfig, Config,
    ConfigError, Entries, LyricsConfig, SettingValue, TimerConfig, WeatherConfig,
    DEFAULT_CONFIG_TOML, THEMES,
};
pub use store::Store;
pub use watch::watch;

#[cfg(test)]
mod tests;
