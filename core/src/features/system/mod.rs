//! Feature `system`: CPU, memory, temperature and network while someone
//! watches, and an alert when memory runs short. The readings come from
//! Linux's `/proc` and `/sys`, or from Windows' own counters.

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod model;
#[cfg(target_os = "linux")]
pub mod pressure;
#[cfg(target_os = "linux")]
pub mod sample;
pub mod service;
#[cfg(windows)]
pub mod win;

#[cfg(test)]
mod tests;
