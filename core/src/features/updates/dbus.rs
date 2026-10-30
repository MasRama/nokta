//! `io.nokta.Updates1` at `/io/nokta/Updates`.

use tokio::sync::{mpsc, watch};
use zbus::{fdo, Connection};

use super::install;
use super::service::{Command, Handle};
use super::UpdateState;
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Updates";
pub const INTERFACE: &str = "io.nokta.Updates1";

pub async fn serve(conn: &Connection, handle: Handle) -> zbus::Result<()> {
    let Handle { commands, state } = handle;
    conn.object_server()
        .at(
            PATH,
            UpdatesInterface {
                commands,
                state: state.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    Ok(())
}

fn properties(s: &UpdateState) -> PropertyList {
    vec![
        ("Latest", owned(s.latest.as_str())),
        ("ReleaseUrl", owned(s.url.as_str())),
    ]
}

struct UpdatesInterface {
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<UpdateState>,
}

#[zbus::interface(name = "io.nokta.Updates1")]
impl UpdatesInterface {
    /// Asks GitHub now; returns at once.
    fn check(&self) {
        // A full queue already holds a check.
        let _ = self.commands.try_send(Command::Check);
    }

    /// Starts `nokta update --yes`.
    async fn install(&self) -> fdo::Result<()> {
        install::start().await.map_err(fdo::Error::Failed)
    }

    #[zbus(property)]
    fn latest(&self) -> String {
        self.state.borrow().latest.clone()
    }

    #[zbus(property)]
    fn release_url(&self) -> String {
        self.state.borrow().url.clone()
    }
}
