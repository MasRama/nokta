//! Feature `calendar`. On Linux: the meeting link of an event in GNOME's
//! calendar and the color of its calendar, read from Evolution Data Server;
//! the shell lists the events itself. On Windows, which has no system
//! calendar to read: the events of the `[calendar] feeds` (iCal addresses).

pub mod cache;
pub mod color;
#[cfg(target_os = "linux")]
pub mod dbus;
#[cfg(target_os = "linux")]
pub mod eds;
pub mod feeds;
pub mod ics;
pub mod link;
pub mod recur;

#[cfg(test)]
mod feeds_tests;
#[cfg(test)]
mod ics_tests;
#[cfg(test)]
mod tests;
