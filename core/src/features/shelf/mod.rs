//! Feature `shelf`: files parked on the notch until they are dragged out
//! again. Only references are kept, in memory, until noktad stops.

#[cfg(target_os = "linux")]
pub mod dbus;
pub mod model;
pub mod service;

#[cfg(test)]
mod tests;

pub use model::Item;
