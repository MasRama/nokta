//! The `nokta` command: reports live activities to noktad from scripts.

pub mod args;
#[cfg(target_os = "linux")]
mod client;
#[cfg(target_os = "linux")]
pub mod run;

#[cfg(test)]
mod tests;
