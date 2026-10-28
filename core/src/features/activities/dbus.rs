//! `io.nokta.Activities1` at `/io/nokta/Activities`.

use tokio::sync::{mpsc, oneshot, watch};
use zbus::object_server::SignalEmitter;
use zbus::{fdo, Connection};

use super::model::{Activity, Ended, Update};
use super::service::{Command, Handle};
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Activities";
pub const INTERFACE: &str = "io.nokta.Activities1";

type Row = (String, String, String, String, f64, i64);

pub async fn serve(conn: &Connection, handle: Handle) -> zbus::Result<()> {
    let Handle {
        commands,
        state,
        mut ended,
    } = handle;
    conn.object_server()
        .at(
            PATH,
            ActivitiesInterface {
                commands,
                state: state.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    let conn = conn.clone();
    tokio::spawn(async move {
        let emitter = SignalEmitter::new(&conn, PATH).expect("static object path is valid");
        while let Some(Ended {
            id,
            title,
            success,
            message,
            elapsed_us,
        }) = ended.recv().await
        {
            let sent =
                ActivitiesInterface::ended(&emitter, &id, &title, success, &message, elapsed_us)
                    .await;
            if let Err(err) = sent {
                tracing::warn!(%err, "cannot emit Ended");
            }
        }
    });
    Ok(())
}

fn rows(list: &[Activity]) -> Vec<Row> {
    list.iter()
        .map(|a| {
            (
                a.id.clone(),
                a.title.clone(),
                a.detail.clone(),
                a.icon.clone(),
                a.progress,
                a.started_us,
            )
        })
        .collect()
}

// `spawn_change_forwarder` takes a reference to the watched value itself.
#[allow(clippy::ptr_arg)]
fn properties(list: &Vec<Activity>) -> PropertyList {
    vec![("Activities", owned(rows(list)))]
}

struct ActivitiesInterface {
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<Vec<Activity>>,
}

fn stopped() -> fdo::Error {
    fdo::Error::Failed("the activities service has stopped".into())
}

#[zbus::interface(name = "io.nokta.Activities1")]
impl ActivitiesInterface {
    #[zbus(property)]
    fn activities(&self) -> Vec<Row> {
        rows(&self.state.borrow())
    }

    async fn set(
        &self,
        id: String,
        title: String,
        detail: String,
        icon: String,
        progress: f64,
    ) -> fdo::Result<()> {
        let (reply, answer) = oneshot::channel();
        let update = Update {
            title,
            detail,
            icon,
            progress,
        };
        self.commands
            .send(Command::Set { id, update, reply })
            .await
            .map_err(|_| stopped())?;
        answer
            .await
            .map_err(|_| stopped())?
            .map_err(|err| fdo::Error::InvalidArgs(err.to_string()))
    }

    async fn end(&self, id: String, success: bool, message: String) -> fdo::Result<()> {
        self.commands
            .send(Command::End {
                id,
                success,
                message,
            })
            .await
            .map_err(|_| stopped())
    }

    #[zbus(signal)]
    async fn ended(
        emitter: &SignalEmitter<'_>,
        id: &str,
        title: &str,
        success: bool,
        message: &str,
        elapsed_us: i64,
    ) -> zbus::Result<()>;
}
