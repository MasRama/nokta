//! Feature `devices`: Bluetooth audio, charger and battery alerts from
//! BlueZ and UPower on the system bus, or from Windows.

#[cfg(target_os = "linux")]
pub mod bluez;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod rules;
#[cfg(target_os = "linux")]
pub mod upower;
#[cfg(any(target_os = "linux", windows))]
pub mod watcher;
#[cfg(windows)]
pub mod win_bluetooth;
#[cfg(windows)]
pub mod win_power;

#[cfg(test)]
mod tests;
