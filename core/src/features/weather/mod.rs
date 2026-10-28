//! Feature `weather`: the current weather at the place set in `[weather]`,
//! from Open-Meteo (<https://open-meteo.com>).

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod model;
pub mod openmeteo;
pub mod service;

#[cfg(test)]
mod tests;

use model::{Condition, Units};

/// What `io.nokta.Weather1.Status` reports.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Status {
    /// Weather is turned off or no location is set.
    #[default]
    Off,
    Loading,
    Ready,
    Error,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Off => "off",
            Status::Loading => "loading",
            Status::Ready => "ready",
            Status::Error => "error",
        }
    }
}

/// The weather at one place, in the units it was asked in.
#[derive(Clone, Debug, PartialEq)]
pub struct Reading {
    /// The place's name; empty when the location is coordinates.
    pub place: String,
    pub temperature: f64,
    pub high: f64,
    pub low: f64,
    pub condition: Condition,
    pub is_day: bool,
}

/// The published weather. `reading` is kept through a failed refresh, so it
/// can be there with `Status::Ready` while the last request failed.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct WeatherState {
    pub status: Status,
    pub units: Units,
    pub reading: Option<Reading>,
}
