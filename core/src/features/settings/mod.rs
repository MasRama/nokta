//! Feature `settings`: config.toml loading, validation, hot reload.

mod config;
pub mod dbus;
pub mod edit;
pub mod service;
mod store;
mod watch;

pub use config::{
    parse, Appearance, Behavior, Config, ConfigError, LyricsConfig, TimerConfig,
    DEFAULT_CONFIG_TOML,
};
pub use store::Store;
pub use watch::watch;

#[cfg(test)]
mod tests;
