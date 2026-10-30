//! Feature `settings`: config.toml loading, validation, hot reload.

mod config;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod edit;
pub mod picture;
pub mod service;
mod store;
mod watch;

pub use config::{
    parse, ActivitiesConfig, Appearance, Behavior, CalendarConfig, ClipboardConfig, Config,
    ConfigError, DownloadsConfig, Entries, HomeConfig, LyricsConfig, SettingValue, SystemConfig,
    TimerConfig, WeatherConfig, DEFAULT_CONFIG_TOML, GRADIENTS, THEMES,
};
pub use store::Store;
pub use watch::watch;

#[cfg(test)]
mod tests;
