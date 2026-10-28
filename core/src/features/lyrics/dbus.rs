//! `io.nokta.Lyrics1` at `/io/nokta/Lyrics`.

use tokio::sync::{mpsc, oneshot, watch};
use zbus::{fdo, Connection};

use super::service::{Command, Handle};
use super::LyricsState;
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Lyrics";
pub const INTERFACE: &str = "io.nokta.Lyrics1";

pub async fn serve(conn: &Connection, handle: Handle) -> zbus::Result<()> {
    let Handle { state, commands } = handle;
    conn.object_server()
        .at(
            PATH,
            LyricsInterface {
                state: state.clone(),
                commands,
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    Ok(())
}

fn lines(s: &LyricsState) -> Vec<(i64, String)> {
    s.lines
        .iter()
        .map(|l| (l.start_us, l.text.clone()))
        .collect()
}

fn properties(s: &LyricsState) -> PropertyList {
    vec![
        ("Status", owned(s.status.as_str())),
        ("Lines", owned(lines(s))),
        ("OffsetMs", owned(s.offset_ms)),
    ]
}

struct LyricsInterface {
    state: watch::Receiver<LyricsState>,
    commands: mpsc::Sender<Command>,
}

#[zbus::interface(name = "io.nokta.Lyrics1")]
impl LyricsInterface {
    #[zbus(property)]
    fn status(&self) -> String {
        self.state.borrow().status.as_str().to_owned()
    }

    #[zbus(property)]
    fn lines(&self) -> Vec<(i64, String)> {
        lines(&self.state.borrow())
    }

    #[zbus(property)]
    fn offset_ms(&self) -> i64 {
        self.state.borrow().offset_ms
    }

    async fn set_offset(&self, offset_ms: i64) -> fdo::Result<()> {
        let stopped = || fdo::Error::Failed("the lyrics service has stopped".into());
        let (done, answer) = oneshot::channel();
        self.commands
            .send(Command::SetOffset(offset_ms, done))
            .await
            .map_err(|_| stopped())?;
        match answer.await.map_err(|_| stopped())? {
            Ok(_) => Ok(()),
            Err(_) => Err(fdo::Error::Failed(
                "no track to set the lyric timing for".into(),
            )),
        }
    }
}
