//! The `nokta` command: reports live activities to noktad from scripts, and
//! updates Nokta.

pub mod args;
#[cfg(target_os = "linux")]
mod client;
#[cfg(target_os = "linux")]
mod local_time;
#[cfg(target_os = "linux")]
pub mod run;
#[cfg(target_os = "linux")]
mod update;

#[cfg(test)]
mod tests;
