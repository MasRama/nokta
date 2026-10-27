//! Feature `settings`: config.toml loading, validation, hot reload.

mod config;
mod store;
mod watch;

pub use config::{
    parse, Appearance, Behavior, Config, ConfigError, LyricsConfig, DEFAULT_CONFIG_TOML,
};
pub use store::Store;
pub use watch::watch;

#[cfg(test)]
mod tests;
