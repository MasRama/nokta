//! Feature `updates`: whether a newer Nokta is out on GitHub, and starting
//! `nokta update` to install it.

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod github;
#[cfg(target_os = "linux")]
mod install;
pub mod model;
pub mod service;

#[cfg(test)]
mod tests;

/// What `io.nokta.Updates1` publishes: the newer version and its release
/// page, both empty when there is none.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UpdateState {
    pub latest: String,
    pub url: String,
}
