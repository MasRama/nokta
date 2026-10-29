//! Feature `activities`: live activities that apps and scripts show in the
//! notch, such as a build or a download.

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod desktop;
pub mod launcher;
#[cfg(target_os = "linux")]
pub mod launcher_watch;
pub mod model;
pub mod packagekit;
#[cfg(target_os = "linux")]
pub mod packagekit_watch;
pub mod service;

#[cfg(test)]
mod launcher_tests;
#[cfg(test)]
mod packagekit_tests;
#[cfg(test)]
mod tests;
