//! The `nokta` command: reports live activities to Nokta from scripts, and
//! updates Nokta. On Linux it talks to noktad over D-Bus, on Windows to the
//! app over a named pipe.

pub mod args;
#[cfg(any(target_os = "linux", windows))]
mod client;
#[cfg(any(target_os = "linux", windows))]
mod local_time;
pub mod pipe;
#[cfg(any(target_os = "linux", windows))]
pub mod run;
#[cfg(target_os = "linux")]
mod update;

#[cfg(test)]
mod tests;
