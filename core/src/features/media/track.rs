#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PlaybackStatus {
    Playing,
    Paused,
    #[default]
    Stopped,
}

impl PlaybackStatus {
    /// Maps an MPRIS `PlaybackStatus` string; anything unknown counts as stopped.
    pub fn from_mpris(s: &str) -> PlaybackStatus {
        match s {
            "Playing" => PlaybackStatus::Playing,
            "Paused" => PlaybackStatus::Paused,
            _ => PlaybackStatus::Stopped,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            PlaybackStatus::Playing => "Playing",
            PlaybackStatus::Paused => "Paused",
            PlaybackStatus::Stopped => "Stopped",
        }
    }
}

/// The track a player is playing: the parts of MPRIS `Metadata` Nokta uses.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Track {
    pub track_id: Option<String>,
    pub title: String,
    pub artists: Vec<String>,
    pub album: String,
    pub length_us: i64,
    pub art_url: Option<String>,
}

impl Track {
    /// What distinguishes one track from the next.
    pub fn identity(&self) -> (Option<&str>, &str, &[String]) {
        (self.track_id.as_deref(), &self.title, &self.artists)
    }
}
