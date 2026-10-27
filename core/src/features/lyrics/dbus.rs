//! `io.nokta.Lyrics1` at `/io/nokta/Lyrics`.

use tokio::sync::watch;
use zbus::Connection;

use super::LyricsState;
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Lyrics";
pub const INTERFACE: &str = "io.nokta.Lyrics1";

pub async fn serve(conn: &Connection, state: watch::Receiver<LyricsState>) -> zbus::Result<()> {
    conn.object_server()
        .at(
            PATH,
            LyricsInterface {
                state: state.clone(),
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
    ]
}

struct LyricsInterface {
    state: watch::Receiver<LyricsState>,
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
}
