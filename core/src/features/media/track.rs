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

/// MPRIS `LoopStatus`: what the player repeats.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LoopStatus {
    #[default]
    None,
    Track,
    Playlist,
}

impl LoopStatus {
    /// The MPRIS value, or None for anything else.
    pub fn from_mpris(s: &str) -> Option<LoopStatus> {
        match s {
            "None" => Some(LoopStatus::None),
            "Track" => Some(LoopStatus::Track),
            "Playlist" => Some(LoopStatus::Playlist),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            LoopStatus::None => "None",
            LoopStatus::Track => "Track",
            LoopStatus::Playlist => "Playlist",
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
    /// Where the song is (MPRIS `xesam:url`), when the player says.
    pub url: Option<String>,
}

impl Track {
    /// What distinguishes one track from the next.
    pub fn identity(&self) -> (Option<&str>, &str, &[String]) {
        (self.track_id.as_deref(), &self.title, &self.artists)
    }
}
