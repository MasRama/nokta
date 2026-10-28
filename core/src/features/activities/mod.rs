//! Feature `activities`: live activities that apps and scripts show in the
//! notch, such as a build or a download.

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod model;
pub mod service;

#[cfg(test)]
mod tests;
