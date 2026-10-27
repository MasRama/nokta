use super::{PlaybackStatus, Track};

/// Everything `io.nokta.Media1` publishes about the active player.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct MediaState {
    pub available: bool,
    pub player_name: String,
    pub status: PlaybackStatus,
    pub track: Track,
    pub art_path: String,
    pub accent_color: String,
    pub position_us: i64,
    pub position_timestamp_us: i64,
    pub rate: f64,
    pub can_play_pause: bool,
    pub can_go_next: bool,
    pub can_go_previous: bool,
    pub can_seek: bool,
}
