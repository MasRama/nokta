//! `io.nokta.Shelf1` at `/io/nokta/Shelf`.

use tokio::sync::{mpsc, watch};
use zbus::{fdo, Connection};

use super::model::Item;
use super::service::{Command, Handle};
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Shelf";
pub const INTERFACE: &str = "io.nokta.Shelf1";

type Row = (String, String, String);

pub async fn serve(conn: &Connection, handle: Handle) -> zbus::Result<()> {
    let Handle { commands, state } = handle;
    conn.object_server()
        .at(
            PATH,
            ShelfInterface {
                commands,
                state: state.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    Ok(())
}

fn rows(items: &[Item]) -> Vec<Row> {
    items
        .iter()
        .map(|i| (i.uri.clone(), i.name.clone(), i.icon.to_owned()))
        .collect()
}

// `spawn_change_forwarder` takes a reference to the watched value itself.
#[allow(clippy::ptr_arg)]
fn properties(items: &Vec<Item>) -> PropertyList {
    vec![("Items", owned(rows(items)))]
}

struct ShelfInterface {
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<Vec<Item>>,
}

impl ShelfInterface {
    async fn send(&self, command: Command) -> fdo::Result<()> {
        self.commands
            .send(command)
            .await
            .map_err(|_| fdo::Error::Failed("the shelf service has stopped".into()))
    }
}

#[zbus::interface(name = "io.nokta.Shelf1")]
impl ShelfInterface {
    #[zbus(property)]
    fn items(&self) -> Vec<Row> {
        rows(&self.state.borrow())
    }

    async fn add(&self, uris: Vec<String>) -> fdo::Result<()> {
        self.send(Command::Add(uris)).await
    }

    async fn remove(&self, uri: String) -> fdo::Result<()> {
        self.send(Command::Remove(uri)).await
    }

    async fn clear(&self) -> fdo::Result<()> {
        self.send(Command::Clear).await
    }
}
