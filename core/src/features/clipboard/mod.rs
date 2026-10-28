//! Feature `clipboard`: a history of what was copied, text and pictures.
//! The extension sees each copy and hands it in; it is kept in memory only.

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod model;
pub mod service;

#[cfg(test)]
mod tests;
