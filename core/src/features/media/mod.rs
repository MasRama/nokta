//! MPRIS media players: the track model, the active-player rules and the
//! state the daemon publishes on `io.nokta.Media1`.

pub mod art;
pub mod control;
mod mpris;
pub mod select;
mod state;
mod track;
pub mod watcher;

pub use select::Selector;
pub use state::MediaState;
pub use track::{PlaybackStatus, Track};

#[cfg(test)]
mod tests;
