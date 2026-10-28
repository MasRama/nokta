//! Feature `timer`: a focus timer with a break after it, and clocks:
//! countdowns, stopwatches and alarms.

pub mod clocks;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod logic;
pub mod service;

#[cfg(test)]
mod tests;
