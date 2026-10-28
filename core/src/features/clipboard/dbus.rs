//! `io.nokta.Clipboard1` at `/io/nokta/Clipboard`.

use tokio::sync::{mpsc, oneshot, watch};
use zbus::{fdo, Connection};

use super::model::Content;
use super::service::{Command, Handle, Published};
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Clipboard";
pub const INTERFACE: &str = "io.nokta.Clipboard1";

type Row = (String, String, String, String, bool, i64);

pub async fn serve(conn: &Connection, handle: Handle) -> zbus::Result<()> {
    let Handle { commands, state } = handle;
    conn.object_server()
        .at(
            PATH,
            ClipboardInterface {
                commands,
                state: state.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    Ok(())
}

fn rows(published: &Published) -> Vec<Row> {
    published
        .items
        .iter()
        .map(|r| {
            (
                r.id.clone(),
                r.kind.to_owned(),
                r.preview.clone(),
                r.thumbnail.clone(),
                r.pinned,
                r.time_us,
            )
        })
        .collect()
}

fn properties(published: &Published) -> PropertyList {
    vec![
        ("Items", owned(rows(published))),
        ("Paused", owned(published.paused)),
    ]
}

struct ClipboardInterface {
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<Published>,
}

impl ClipboardInterface {
    async fn send(&self, command: Command) -> fdo::Result<()> {
        self.commands
            .send(command)
            .await
            .map_err(|_| fdo::Error::Failed("the clipboard service has stopped".into()))
    }
}

#[zbus::interface(name = "io.nokta.Clipboard1")]
impl ClipboardInterface {
    #[zbus(property)]
    fn items(&self) -> Vec<Row> {
        rows(&self.state.borrow())
    }

    #[zbus(property)]
    fn paused(&self) -> bool {
        self.state.borrow().paused
    }

    async fn add(&self, kind: String, text: String, image: Vec<u8>) -> fdo::Result<()> {
        match Content::new(&kind, &text, image) {
            Some(content) => self.send(Command::Add(content)).await,
            None => Ok(()),
        }
    }

    #[zbus(out_args("kind", "text", "image"))]
    async fn get(&self, id: String) -> fdo::Result<(String, String, Vec<u8>)> {
        let (reply, answer) = oneshot::channel();
        self.send(Command::Get(id.clone(), reply)).await?;
        match answer.await {
            Ok(Some(Content::Text(text))) => Ok(("text".into(), text, Vec::new())),
            Ok(Some(Content::Image(png))) => Ok(("image".into(), String::new(), png)),
            _ => Err(fdo::Error::InvalidArgs(format!(
                "no clipboard entry {id:?}"
            ))),
        }
    }

    async fn pin(&self, id: String, pinned: bool) -> fdo::Result<()> {
        self.send(Command::Pin(id, pinned)).await
    }

    async fn remove(&self, id: String) -> fdo::Result<()> {
        self.send(Command::Remove(id)).await
    }

    async fn clear(&self) -> fdo::Result<()> {
        self.send(Command::Clear).await
    }

    async fn set_paused(&self, paused: bool) -> fdo::Result<()> {
        self.send(Command::SetPaused(paused)).await
    }
}
