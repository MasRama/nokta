//! Feature `devices`: Bluetooth audio, charger and battery alerts from
//! BlueZ and UPower on the system bus.

#[cfg(target_os = "linux")]
pub mod bluez;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod rules;
#[cfg(target_os = "linux")]
pub mod upower;
#[cfg(target_os = "linux")]
pub mod watcher;

#[cfg(test)]
mod tests;
