//! MPRIS media players: the track model, the active-player rules and the
//! state the daemon publishes on `io.nokta.Media1`.

pub mod art;
#[cfg(target_os = "linux")]
pub mod capture;
#[cfg(target_os = "linux")]
pub mod control;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod levels;
#[cfg(target_os = "linux")]
mod mpris;
pub mod select;
mod state;
mod track;
#[cfg(target_os = "linux")]
pub mod watcher;

pub use select::Selector;
pub use state::MediaState;
pub use track::{LoopStatus, PlaybackStatus, Track};

#[cfg(test)]
mod levels_tests;
#[cfg(test)]
mod tests;
