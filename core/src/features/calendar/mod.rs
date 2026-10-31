//! Feature `calendar`. On Linux: the meeting link of an event in GNOME's
//! calendar and the color of its calendar, read from Evolution Data Server;
//! the shell lists the events itself. `ics.rs` reads the timed events of an
//! iCalendar feed.

pub mod cache;
pub mod color;
#[cfg(target_os = "linux")]
pub mod dbus;
#[cfg(target_os = "linux")]
pub mod eds;
pub mod ics;
pub mod link;
pub mod recur;

#[cfg(test)]
mod ics_tests;
#[cfg(test)]
mod tests;
