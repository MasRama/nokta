//! Feature `timer`: a focus timer with a break after it.

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod logic;
pub mod service;

#[cfg(test)]
mod tests;
