//! Feature `settings`: config.toml loading, validation, hot reload.

mod config;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod edit;
pub mod picture;
pub mod service;
mod store;
mod watch;
mod writer;

pub use config::{
    parse, ActivitiesConfig, Appearance, Behavior, CalendarConfig, ClipboardConfig, Config,
    ConfigError, DownloadsConfig, Entries, HomeConfig, LyricsConfig, SettingValue, SystemConfig,
    TimerConfig, UpdatesConfig, WeatherConfig, DEFAULT_CONFIG_TOML, GRADIENTS, THEMES,
};
pub use store::Store;
pub use watch::watch;
pub use writer::{WriteError, Writer};

#[cfg(test)]
mod tests;
