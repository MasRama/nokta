//! Feature `calendar`: the meeting link of an event in GNOME's calendar and
//! the color of its calendar, read from Evolution Data Server. The shell
//! lists the events itself.

pub mod cache;
pub mod color;
#[cfg(target_os = "linux")]
pub mod dbus;
#[cfg(target_os = "linux")]
pub mod eds;
pub mod link;

#[cfg(test)]
mod tests;
