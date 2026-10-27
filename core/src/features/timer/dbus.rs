//! `io.nokta.Timer1` at `/io/nokta/Timer`.

use tokio::sync::{mpsc, watch};
use zbus::object_server::SignalEmitter;
use zbus::{fdo, Connection};

use super::logic::{Phase, Snapshot};
use super::service::Command;
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Timer";
pub const INTERFACE: &str = "io.nokta.Timer1";

pub async fn serve(
    conn: &Connection,
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<Snapshot>,
    mut finished: mpsc::Receiver<Phase>,
) -> zbus::Result<()> {
    conn.object_server()
        .at(
            PATH,
            TimerInterface {
                commands,
                state: state.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    let conn = conn.clone();
    tokio::spawn(async move {
        let emitter = SignalEmitter::new(&conn, PATH).expect("static object path is valid");
        while let Some(phase) = finished.recv().await {
            if let Err(err) = TimerInterface::finished(&emitter, phase.as_str()).await {
                tracing::warn!(%err, "cannot emit Finished");
            }
        }
    });
    Ok(())
}

fn properties(s: &Snapshot) -> PropertyList {
    vec![
        ("State", owned(s.state.as_str())),
        ("Phase", owned(s.phase.map_or("", Phase::as_str))),
        ("DurationUs", owned(s.duration_us)),
        ("RemainingUs", owned(s.remaining_us)),
        ("TimestampUs", owned(s.timestamp_us)),
    ]
}

struct TimerInterface {
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<Snapshot>,
}

impl TimerInterface {
    async fn send(&self, command: Command) -> fdo::Result<()> {
        self.commands
            .send(command)
            .await
            .map_err(|_| fdo::Error::Failed("the timer has stopped".into()))
    }
}

#[zbus::interface(name = "io.nokta.Timer1")]
impl TimerInterface {
    #[zbus(property)]
    fn state(&self) -> String {
        self.state.borrow().state.as_str().into()
    }

    #[zbus(property)]
    fn phase(&self) -> String {
        self.state.borrow().phase.map_or("", Phase::as_str).into()
    }

    #[zbus(property)]
    fn duration_us(&self) -> i64 {
        self.state.borrow().duration_us
    }

    #[zbus(property)]
    fn remaining_us(&self) -> i64 {
        self.state.borrow().remaining_us
    }

    #[zbus(property)]
    fn timestamp_us(&self) -> i64 {
        self.state.borrow().timestamp_us
    }

    async fn start(&self, phase: String) -> fdo::Result<()> {
        let phase = Phase::parse(&phase).ok_or_else(|| {
            fdo::Error::InvalidArgs(format!(
                "phase must be \"focus\" or \"break\", got {phase:?}"
            ))
        })?;
        self.send(Command::Start(phase)).await
    }

    async fn pause(&self) -> fdo::Result<()> {
        self.send(Command::Pause).await
    }

    async fn resume(&self) -> fdo::Result<()> {
        self.send(Command::Resume).await
    }

    async fn stop(&self) -> fdo::Result<()> {
        self.send(Command::Stop).await
    }

    #[zbus(signal)]
    async fn finished(emitter: &SignalEmitter<'_>, phase: &str) -> zbus::Result<()>;
}
