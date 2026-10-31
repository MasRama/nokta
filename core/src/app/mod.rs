//! Wires the features together. [`Services`] starts what runs on every
//! system; on Linux, `dbus` adds the media players and device alerts and
//! serves everything on the session bus.

#[cfg(target_os = "linux")]
mod dbus;
#[cfg(target_os = "linux")]
mod nokta_iface;
mod services;

use crate::features::weather;

pub use services::{follow, Services, Timer};

pub const BUS_NAME: &str = "io.nokta.Nokta";
pub const DEFAULT_LRCLIB_URL: &str = "https://lrclib.net";
pub const USER_AGENT: &str = concat!(
    "Nokta/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/MasRama/nokta)"
);

pub struct RunOptions {
    /// Bus to connect to instead of the session bus (tests use a private one).
    pub bus_address: Option<String>,
    /// System bus to watch UPower and BlueZ on instead of the real one.
    pub system_bus_address: Option<String>,
    pub lrclib_base_url: String,
    pub open_meteo: OpenMeteoUrls,
    /// Where noktad asks for Nokta's latest release.
    pub github_api_url: String,
    /// What records the music for the bars that follow it: `pw-record`.
    pub recorder: String,
}

/// Where noktad asks for the weather.
#[derive(Clone, Debug)]
pub struct OpenMeteoUrls {
    pub forecast: String,
    pub geocoding: String,
}

impl Default for OpenMeteoUrls {
    fn default() -> Self {
        OpenMeteoUrls {
            forecast: weather::openmeteo::DEFAULT_FORECAST_URL.to_owned(),
            geocoding: weather::openmeteo::DEFAULT_GEOCODING_URL.to_owned(),
        }
    }
}

/// Runs the daemon until SIGTERM or SIGINT. Returns `Ok` straight away when
/// another instance already owns the bus name.
#[cfg(target_os = "linux")]
pub async fn run(paths: crate::shared::paths::Paths, options: RunOptions) -> anyhow::Result<()> {
    dbus::run(paths, options).await
}

/// Nokta has no frontend outside Linux yet, so there is nothing to serve.
#[cfg(not(target_os = "linux"))]
pub async fn run(_paths: crate::shared::paths::Paths, _options: RunOptions) -> anyhow::Result<()> {
    anyhow::bail!("Nokta has no frontend on this system yet")
}
