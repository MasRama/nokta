//! `io.nokta.Media1` at `/io/nokta/Media`.

use tokio::sync::watch;
use zbus::{fdo, Connection};

use super::control::Controller;
use super::{LoopStatus, MediaState};
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Media";
pub const INTERFACE: &str = "io.nokta.Media1";

pub async fn serve(
    conn: &Connection,
    state: watch::Receiver<MediaState>,
    control: Controller,
) -> zbus::Result<()> {
    conn.object_server()
        .at(
            PATH,
            MediaInterface {
                state: state.clone(),
                control,
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    Ok(())
}

fn properties(s: &MediaState) -> PropertyList {
    vec![
        ("Available", owned(s.available)),
        ("PlayerId", owned(s.player_id.as_str())),
        ("PlayerName", owned(s.player_name.as_str())),
        ("Players", owned(s.players.clone())),
        ("PlaybackStatus", owned(s.status.as_str())),
        ("Title", owned(s.track.title.as_str())),
        ("Artists", owned(s.track.artists.clone())),
        ("Album", owned(s.track.album.as_str())),
        ("LengthUs", owned(s.track.length_us)),
        ("ArtPath", owned(s.art_path.as_str())),
        ("AccentColor", owned(s.accent_color.as_str())),
        ("PositionUs", owned(s.position_us)),
        ("PositionTimestampUs", owned(s.position_timestamp_us)),
        ("Rate", owned(s.rate)),
        ("CanPlayPause", owned(s.can_play_pause)),
        ("CanGoNext", owned(s.can_go_next)),
        ("CanGoPrevious", owned(s.can_go_previous)),
        ("CanSeek", owned(s.can_seek)),
        ("Shuffle", owned(s.shuffle)),
        ("LoopStatus", owned(s.loop_status.as_str())),
        ("CanShuffle", owned(s.can_shuffle)),
        ("CanLoop", owned(s.can_loop)),
    ]
}

struct MediaInterface {
    state: watch::Receiver<MediaState>,
    control: Controller,
}

fn failed(err: zbus::Error) -> fdo::Error {
    fdo::Error::Failed(err.to_string())
}

#[zbus::interface(name = "io.nokta.Media1")]
impl MediaInterface {
    async fn play_pause(&self) -> fdo::Result<()> {
        self.control.play_pause().await.map_err(failed)
    }

    async fn next(&self) -> fdo::Result<()> {
        self.control.next().await.map_err(failed)
    }

    async fn previous(&self) -> fdo::Result<()> {
        self.control.previous().await.map_err(failed)
    }

    async fn set_position(&self, position_us: i64) -> fdo::Result<()> {
        self.control.set_position(position_us).await.map_err(failed)
    }

    async fn refresh_position(&self) -> fdo::Result<()> {
        self.control.refresh_position().await.map_err(failed)
    }

    async fn select_player(&self, id: String) -> fdo::Result<()> {
        self.control.select_player(&id).await.map_err(failed)
    }

    async fn set_shuffle(&self, shuffle: bool) -> fdo::Result<()> {
        self.control.set_shuffle(shuffle).await.map_err(failed)
    }

    async fn set_loop_status(&self, status: String) -> fdo::Result<()> {
        let status = LoopStatus::from_mpris(&status).ok_or_else(|| {
            fdo::Error::InvalidArgs(format!(
                "loop status must be None, Track or Playlist, got {status:?}"
            ))
        })?;
        self.control.set_loop_status(status).await.map_err(failed)
    }

    #[zbus(property)]
    fn available(&self) -> bool {
        self.state.borrow().available
    }

    #[zbus(property)]
    fn player_id(&self) -> String {
        self.state.borrow().player_id.clone()
    }

    #[zbus(property)]
    fn player_name(&self) -> String {
        self.state.borrow().player_name.clone()
    }

    #[zbus(property)]
    fn players(&self) -> Vec<(String, String)> {
        self.state.borrow().players.clone()
    }

    #[zbus(property)]
    fn playback_status(&self) -> String {
        self.state.borrow().status.as_str().to_owned()
    }

    #[zbus(property)]
    fn title(&self) -> String {
        self.state.borrow().track.title.clone()
    }

    #[zbus(property)]
    fn artists(&self) -> Vec<String> {
        self.state.borrow().track.artists.clone()
    }

    #[zbus(property)]
    fn album(&self) -> String {
        self.state.borrow().track.album.clone()
    }

    #[zbus(property)]
    fn length_us(&self) -> i64 {
        self.state.borrow().track.length_us
    }

    #[zbus(property)]
    fn art_path(&self) -> String {
        self.state.borrow().art_path.clone()
    }

    #[zbus(property)]
    fn accent_color(&self) -> String {
        self.state.borrow().accent_color.clone()
    }

    #[zbus(property)]
    fn position_us(&self) -> i64 {
        self.state.borrow().position_us
    }

    #[zbus(property)]
    fn position_timestamp_us(&self) -> i64 {
        self.state.borrow().position_timestamp_us
    }

    #[zbus(property)]
    fn rate(&self) -> f64 {
        self.state.borrow().rate
    }

    #[zbus(property)]
    fn can_play_pause(&self) -> bool {
        self.state.borrow().can_play_pause
    }

    #[zbus(property)]
    fn can_go_next(&self) -> bool {
        self.state.borrow().can_go_next
    }

    #[zbus(property)]
    fn can_go_previous(&self) -> bool {
        self.state.borrow().can_go_previous
    }

    #[zbus(property)]
    fn can_seek(&self) -> bool {
        self.state.borrow().can_seek
    }

    #[zbus(property)]
    fn shuffle(&self) -> bool {
        self.state.borrow().shuffle
    }

    #[zbus(property)]
    fn loop_status(&self) -> String {
        self.state.borrow().loop_status.as_str().to_owned()
    }

    #[zbus(property)]
    fn can_shuffle(&self) -> bool {
        self.state.borrow().can_shuffle
    }

    #[zbus(property)]
    fn can_loop(&self) -> bool {
        self.state.borrow().can_loop
    }
}
