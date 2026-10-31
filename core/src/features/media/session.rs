//! Windows media sessions (the system media transport controls, GSMTC) as
//! plain data, and the media state they give. Pure, so it is tested on
//! every system; `gsmtc.rs` reads the sessions on Windows.

use super::art::ArtInfo;
use super::{LoopStatus, MediaState, PlaybackStatus, Selector, Track};

/// What the user asks of the active session.
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    PlayPause,
    Next,
    Previous,
    /// Where to go in the track, in µs from its start.
    SetPosition(i64),
    SetShuffle(bool),
    SetLoop(LoopStatus),
    /// Makes the session with this id the active one.
    Select(String),
    /// Reads every session again.
    Refresh,
}

/// One app's media session as Windows reports it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Session {
    /// The app's AppUserModelID, like `Spotify.exe`.
    pub id: String,
    pub status: PlaybackStatus,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// The timeline, in µs: the track runs from `start_us` to `end_us`.
    pub start_us: i64,
    pub end_us: i64,
    pub position_us: i64,
    /// When the app last set `position_us`, in µs since the Unix epoch.
    pub updated_unix_us: i64,
    pub rate: Option<f64>,
    pub shuffle: Option<bool>,
    pub repeat: Option<LoopStatus>,
    pub can_play_pause: bool,
    pub can_go_next: bool,
    pub can_go_previous: bool,
    pub can_seek: bool,
}

/// `GlobalSystemMediaTransportControlsSessionPlaybackStatus`: 4 plays, 5 is
/// paused; closed, opened, changing and stopped show no player.
pub fn status_from_gsmtc(code: i32) -> PlaybackStatus {
    match code {
        4 => PlaybackStatus::Playing,
        5 => PlaybackStatus::Paused,
        _ => PlaybackStatus::Stopped,
    }
}

/// `MediaPlaybackAutoRepeatMode`: 0 none, 1 the track, 2 the list.
pub fn loop_from_gsmtc(code: i32) -> Option<LoopStatus> {
    match code {
        0 => Some(LoopStatus::None),
        1 => Some(LoopStatus::Track),
        2 => Some(LoopStatus::Playlist),
        _ => None,
    }
}

pub fn gsmtc_loop(status: LoopStatus) -> i32 {
    match status {
        LoopStatus::None => 0,
        LoopStatus::Track => 1,
        LoopStatus::Playlist => 2,
    }
}

/// 100 ns ticks between 1601 and 1970, Windows' `DateTime` epoch to Unix's.
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

/// A Windows `DateTime` (100 ns ticks since 1601) in µs since the Unix epoch.
pub fn unix_us_from_ticks(ticks: i64) -> i64 {
    (ticks - UNIX_EPOCH_TICKS) / 10
}

/// A name for the app with the AppUserModelID `id`, when Windows gives none:
/// a desktop app's file name without `.exe`, or a Store app's application
/// id after its package (`…!Spotify`), with a few well-known ones spelled out.
pub fn player_name(id: &str) -> String {
    let base = match id.rsplit_once('!') {
        Some((package, app)) if app.eq_ignore_ascii_case("app") => {
            // `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!App`: the package's last word.
            let family = package.split('_').next().unwrap_or(package);
            family.rsplit('.').next().unwrap_or(family)
        }
        Some((_, app)) => app.rsplit('.').next().unwrap_or(app),
        None => {
            let file = id.rsplit(['\\', '/']).next().unwrap_or(id);
            file.strip_suffix(".exe")
                .or_else(|| file.strip_suffix(".EXE"))
                .unwrap_or(file)
        }
    };
    let known = match base.to_ascii_lowercase().as_str() {
        "chrome" => "Chrome",
        "msedge" => "Edge",
        "firefox" => "Firefox",
        "spotify" | "spotifymusic" => "Spotify",
        "zunemusic" => "Media Player",
        "brave" => "Brave",
        "opera" => "Opera",
        "vlc" => "VLC",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_owned();
    }
    let mut chars = base.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => id.to_owned(),
    }
}

impl Session {
    /// The state Nokta shows for this session: `art` is its cover, `name`
    /// the app's, and the clocks now are `now_unix_us` and `now_mono_us`.
    pub fn to_state(
        &self,
        name: &str,
        art: Option<&ArtInfo>,
        now_unix_us: i64,
        now_mono_us: i64,
    ) -> MediaState {
        let path = |p: &std::path::Path| p.to_string_lossy().into_owned();
        // The position was read at `updated_unix_us`: the same moment on the monotonic clock.
        let age_us = (now_unix_us - self.updated_unix_us).max(0);
        MediaState {
            available: true,
            player_id: self.id.clone(),
            player_name: name.to_owned(),
            players: Vec::new(),
            status: self.status,
            track: Track {
                track_id: None,
                title: self.title.clone(),
                artists: if self.artist.is_empty() {
                    Vec::new()
                } else {
                    vec![self.artist.clone()]
                },
                album: self.album.clone(),
                length_us: (self.end_us - self.start_us).max(0),
                art_url: None,
                url: None,
            },
            art_path: art.map(|a| path(&a.path)).unwrap_or_default(),
            accent_color: art.and_then(|a| a.accent.clone()).unwrap_or_default(),
            backdrop_path: art
                .and_then(|a| a.backdrop.as_deref())
                .map(path)
                .unwrap_or_default(),
            position_us: (self.position_us - self.start_us).max(0),
            position_timestamp_us: now_mono_us - age_us,
            rate: self.rate.unwrap_or(1.0),
            can_play_pause: self.can_play_pause,
            can_go_next: self.can_go_next,
            can_go_previous: self.can_go_previous,
            can_seek: self.can_seek,
            shuffle: self.shuffle.unwrap_or(false),
            loop_status: self.repeat.unwrap_or_default(),
            can_shuffle: self.shuffle.is_some(),
            can_loop: self.repeat.is_some(),
        }
    }
}

/// Tells `selector` about the sessions now: their status, and the ones gone.
pub fn track_sessions(selector: &mut Selector, sessions: &[Session], known: &mut Vec<String>) {
    for gone in known
        .iter()
        .filter(|id| !sessions.iter().any(|s| &s.id == *id))
    {
        selector.remove(gone);
    }
    for session in sessions {
        selector.set_status(&session.id, session.status);
    }
    *known = sessions.iter().map(|s| s.id.clone()).collect();
}

/// The media state for the active session, with every running one listed.
pub fn media_state(
    selector: &Selector,
    sessions: &[Session],
    mut name: impl FnMut(&str) -> String,
    art: Option<&ArtInfo>,
    now_unix_us: i64,
    now_mono_us: i64,
) -> MediaState {
    let find = |id: &str| sessions.iter().find(|s| s.id == id);
    let mut state = selector
        .active()
        .and_then(find)
        .map(|s| s.to_state(&name(&s.id), art, now_unix_us, now_mono_us))
        .unwrap_or_default();
    state.players = selector
        .players()
        .into_iter()
        .filter(|id| find(id).is_some())
        .map(|id| (id.to_owned(), name(id)))
        .collect();
    state
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn session(id: &str, status: PlaybackStatus) -> Session {
        Session {
            id: id.to_owned(),
            status,
            title: "Song".into(),
            artist: "Band".into(),
            album: "Record".into(),
            start_us: 0,
            end_us: 200_000_000,
            position_us: 30_000_000,
            updated_unix_us: 1_000_000_000,
            rate: Some(1.0),
            shuffle: None,
            repeat: Some(LoopStatus::None),
            can_play_pause: true,
            can_go_next: true,
            can_go_previous: false,
            can_seek: true,
        }
    }

    #[test]
    fn statuses_and_repeat_modes_map_from_gsmtc() {
        assert_eq!(status_from_gsmtc(4), PlaybackStatus::Playing);
        assert_eq!(status_from_gsmtc(5), PlaybackStatus::Paused);
        for closed in [0, 1, 2, 3, 9] {
            assert_eq!(status_from_gsmtc(closed), PlaybackStatus::Stopped);
        }
        for status in [LoopStatus::None, LoopStatus::Track, LoopStatus::Playlist] {
            assert_eq!(loop_from_gsmtc(gsmtc_loop(status)), Some(status));
        }
        assert_eq!(loop_from_gsmtc(7), None);
    }

    #[test]
    fn windows_ticks_become_unix_microseconds() {
        assert_eq!(unix_us_from_ticks(UNIX_EPOCH_TICKS), 0);
        // 2026-01-01T00:00:00Z.
        assert_eq!(
            unix_us_from_ticks(134_116_992_000_000_000),
            1_767_225_600_000_000
        );
    }

    #[test]
    fn apps_get_readable_names() {
        assert_eq!(player_name("Spotify.exe"), "Spotify");
        assert_eq!(
            player_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"),
            "Spotify"
        );
        assert_eq!(
            player_name("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"),
            "Media Player"
        );
        assert_eq!(player_name("chrome"), "Chrome");
        assert_eq!(player_name("MSEdge"), "Edge");
        assert_eq!(
            player_name(r"C:\Program Files\foobar2000\foobar2000.exe"),
            "Foobar2000"
        );
        assert_eq!(player_name("Contoso.Tunes_abc!App"), "Tunes");
        assert_eq!(player_name(""), "");
    }

    #[test]
    fn a_session_becomes_the_state_with_its_cover_and_position() {
        let art = ArtInfo {
            path: PathBuf::from("art.png"),
            accent: Some("#336699".into()),
            backdrop: Some(PathBuf::from("art.backdrop.png")),
        };
        let mut s = session("Spotify.exe", PlaybackStatus::Playing);
        s.start_us = 5_000_000;
        let state = s.to_state("Spotify", Some(&art), 1_002_000_000, 50_000_000);
        assert!(state.available);
        assert_eq!(state.player_id, "Spotify.exe");
        assert_eq!(state.track.artists, vec!["Band".to_owned()]);
        assert_eq!(state.track.length_us, 195_000_000);
        assert_eq!(state.position_us, 25_000_000);
        // Read 2 s ago on the wall clock: 2 s ago on the monotonic one.
        assert_eq!(state.position_timestamp_us, 48_000_000);
        assert_eq!(state.art_path, "art.png");
        assert_eq!(state.accent_color, "#336699");
        assert_eq!(state.backdrop_path, "art.backdrop.png");
        assert!(!state.can_shuffle);
        assert!(state.can_loop);
    }

    #[test]
    fn an_app_without_an_artist_has_none() {
        let mut s = session("chrome", PlaybackStatus::Paused);
        s.artist.clear();
        assert!(s.to_state("Chrome", None, 0, 0).track.artists.is_empty());
    }

    #[test]
    fn the_playing_session_is_shown_and_every_running_one_listed() {
        let mut selector = Selector::default();
        let mut known = Vec::new();
        let sessions = vec![
            session("chrome", PlaybackStatus::Paused),
            session("Spotify.exe", PlaybackStatus::Playing),
            session("vlc.exe", PlaybackStatus::Stopped),
        ];
        track_sessions(&mut selector, &sessions, &mut known);
        let state = media_state(&selector, &sessions, player_name, None, 0, 0);
        assert_eq!(state.player_id, "Spotify.exe");
        assert_eq!(
            state.players,
            vec![
                ("chrome".to_owned(), "Chrome".to_owned()),
                ("Spotify.exe".to_owned(), "Spotify".to_owned())
            ]
        );

        // Spotify closes: Chrome, paused, is left.
        let sessions = vec![session("chrome", PlaybackStatus::Paused)];
        track_sessions(&mut selector, &sessions, &mut known);
        let state = media_state(&selector, &sessions, player_name, None, 0, 0);
        assert_eq!(state.player_id, "chrome");
        assert_eq!(known, vec!["chrome".to_owned()]);

        track_sessions(&mut selector, &[], &mut known);
        assert!(!media_state(&selector, &[], player_name, None, 0, 0).available);
    }
}
