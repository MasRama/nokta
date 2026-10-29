use super::{LoopStatus, PlaybackStatus, Track};

/// Everything `io.nokta.Media1` publishes about the active player.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct MediaState {
    pub available: bool,
    /// The active player's id: its unique bus name.
    pub player_id: String,
    pub player_name: String,
    /// Every playing or paused player as (id, display name), oldest first.
    pub players: Vec<(String, String)>,
    pub status: PlaybackStatus,
    pub track: Track,
    pub art_path: String,
    pub accent_color: String,
    /// The cover downsized and blurred, empty when there is none.
    pub backdrop_path: String,
    pub position_us: i64,
    pub position_timestamp_us: i64,
    pub rate: f64,
    pub can_play_pause: bool,
    pub can_go_next: bool,
    pub can_go_previous: bool,
    pub can_seek: bool,
    /// False when the player has no shuffle.
    pub shuffle: bool,
    /// `None` when the player has no repeat.
    pub loop_status: LoopStatus,
    pub can_shuffle: bool,
    pub can_loop: bool,
}
