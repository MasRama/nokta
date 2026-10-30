//! Feature `downloads`: a file that finishes downloading into the download
//! folder, for the notch to show.

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod model;
pub mod service;
pub mod watch;

#[cfg(test)]
mod tests;
