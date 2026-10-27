//! Feature `devices`: Bluetooth audio, charger and battery alerts from
//! BlueZ and UPower on the system bus.

pub mod bluez;
pub mod dbus;
pub mod rules;
pub mod upower;
pub mod watcher;

#[cfg(test)]
mod tests;
