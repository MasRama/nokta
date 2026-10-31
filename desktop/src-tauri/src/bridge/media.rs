//! `Media1`: the active player, from Windows' media sessions.
//!
//! On D-Bus `PositionTimestampUs` is on the monotonic clock the extension
//! reads; the page has none, so here it is on the wall clock in µs, the
//! page's `Date.now() * 1000`.

use nokta_core::features::media::session::Command;
use nokta_core::features::media::{LoopStatus, MediaState};
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "Media1";

/// The properties; `now_mono_us` and `now_wall_us` are the same moment on
/// both clocks.
pub fn props(s: &MediaState, now_mono_us: i64, now_wall_us: i64) -> Props {
    let players: Vec<Value> = s
        .players
        .iter()
        .map(|(id, name)| json!([id, name]))
        .collect();
    let timestamp = now_wall_us - (now_mono_us - s.position_timestamp_us);
    let mut props = Props::new();
    for (name, value) in [
        ("Available", json!(s.available)),
        ("PlayerId", json!(s.player_id)),
        ("PlayerName", json!(s.player_name)),
        ("Players", Value::Array(players)),
        ("PlaybackStatus", json!(s.status.as_str())),
        ("Title", json!(s.track.title)),
        ("Artists", json!(s.track.artists)),
        ("Album", json!(s.track.album)),
        ("LengthUs", json!(s.track.length_us)),
        ("ArtPath", json!(s.art_path)),
        ("AccentColor", json!(s.accent_color)),
        ("BackdropPath", json!(s.backdrop_path)),
        ("PositionUs", json!(s.position_us)),
        ("PositionTimestampUs", json!(timestamp)),
        ("Rate", json!(s.rate)),
        ("CanPlayPause", json!(s.can_play_pause)),
        ("CanGoNext", json!(s.can_go_next)),
        ("CanGoPrevious", json!(s.can_go_previous)),
        ("CanSeek", json!(s.can_seek)),
        ("Shuffle", json!(s.shuffle)),
        ("LoopStatus", json!(s.loop_status.as_str())),
        ("CanShuffle", json!(s.can_shuffle)),
        ("CanLoop", json!(s.can_loop)),
    ] {
        props.insert(name.into(), value);
    }
    props
}

/// The command for a call of `method(args)`.
pub fn command(method: &str, args: &[Value]) -> Result<Command, String> {
    Ok(match (method, args) {
        ("PlayPause", []) => Command::PlayPause,
        ("Next", []) => Command::Next,
        ("Previous", []) => Command::Previous,
        ("RefreshPosition", []) => Command::Refresh,
        ("SetPosition", [position]) => Command::SetPosition(
            position
                .as_f64()
                .map(|us| us.round() as i64)
                .ok_or("the position must be a number")?,
        ),
        ("SelectPlayer", [Value::String(id)]) => Command::Select(id.clone()),
        ("SetShuffle", [Value::Bool(on)]) => Command::SetShuffle(*on),
        ("SetLoopStatus", [Value::String(status)]) => {
            Command::SetLoop(LoopStatus::from_mpris(status).ok_or_else(|| {
                format!("loop status must be None, Track or Playlist, got {status:?}")
            })?)
        }
        _ => {
            return Err(format!(
                "no method {INTERFACE}.{method} for {} arguments",
                args.len()
            ))
        }
    })
}

#[cfg(test)]
mod tests {
    use nokta_core::features::media::PlaybackStatus;

    use super::*;

    #[test]
    fn the_position_is_stamped_on_the_wall_clock() {
        let state = MediaState {
            available: true,
            status: PlaybackStatus::Playing,
            position_us: 30_000_000,
            position_timestamp_us: 9_000_000,
            players: vec![("Spotify.exe".into(), "Spotify".into())],
            ..MediaState::default()
        };
        // Read 1 s before now on both clocks.
        let props = props(&state, 10_000_000, 1_767_225_600_000_000);
        assert_eq!(
            props["PositionTimestampUs"],
            json!(1_767_225_599_000_000_i64)
        );
        assert_eq!(props["PlaybackStatus"], json!("Playing"));
        assert_eq!(props["Players"], json!([["Spotify.exe", "Spotify"]]));
    }

    #[test]
    fn calls_become_commands() {
        assert_eq!(command("PlayPause", &[]), Ok(Command::PlayPause));
        assert_eq!(command("RefreshPosition", &[]), Ok(Command::Refresh));
        assert_eq!(
            command("SetPosition", &[json!(12_500_000.0)]),
            Ok(Command::SetPosition(12_500_000))
        );
        assert_eq!(
            command("SelectPlayer", &[json!("chrome")]),
            Ok(Command::Select("chrome".into()))
        );
        assert_eq!(
            command("SetLoopStatus", &[json!("Track")]),
            Ok(Command::SetLoop(LoopStatus::Track))
        );
        assert!(command("SetLoopStatus", &[json!("Twice")]).is_err());
        assert!(command("SetShuffle", &[json!("yes")]).is_err());
        assert!(command("Stop", &[]).is_err());
    }
}
