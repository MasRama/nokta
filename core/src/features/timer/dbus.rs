//! `io.nokta.Timer1` at `/io/nokta/Timer`.

use tokio::sync::{mpsc, oneshot, watch};
use zbus::object_server::SignalEmitter;
use zbus::{fdo, Connection};

use super::clocks::AddError;
use super::logic::{Phase, Snapshot};
use super::service::{ClockCommand, ClocksHandle, ClocksSnapshot, Command};
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Timer";
pub const INTERFACE: &str = "io.nokta.Timer1";

/// One clock as `Clocks` lists it.
type ClockTuple = (String, String, String, bool, i64, i64, i64, i64);

pub async fn serve(
    conn: &Connection,
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<Snapshot>,
    mut finished: mpsc::Receiver<Phase>,
    clocks: ClocksHandle,
) -> zbus::Result<()> {
    let ClocksHandle {
        commands: clock_commands,
        state: clocks_state,
        mut done,
    } = clocks;
    conn.object_server()
        .at(
            PATH,
            TimerInterface {
                commands,
                state: state.clone(),
                clock_commands,
                clocks: clocks_state.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    spawn_change_forwarder(
        conn.clone(),
        PATH,
        INTERFACE,
        clocks_state,
        clock_properties,
    );
    let conn = conn.clone();
    tokio::spawn(async move {
        let emitter = SignalEmitter::new(&conn, PATH).expect("static object path is valid");
        loop {
            let result = tokio::select! {
                phase = finished.recv() => match phase {
                    Some(phase) => TimerInterface::finished(&emitter, phase.as_str()).await,
                    None => break,
                },
                clock = done.recv() => match clock {
                    Some(c) => TimerInterface::clock_done(&emitter, &c.id, c.kind.as_str(), &c.label).await,
                    None => break,
                },
            };
            if let Err(err) = result {
                tracing::warn!(%err, "cannot emit a timer signal");
            }
        }
    });
    Ok(())
}

fn clock_properties(s: &ClocksSnapshot) -> PropertyList {
    vec![("Clocks", owned(clock_tuples(s)))]
}

fn clock_tuples(s: &ClocksSnapshot) -> Vec<ClockTuple> {
    s.clocks
        .iter()
        .map(|c| {
            (
                c.id.clone(),
                c.kind.as_str().to_owned(),
                c.label.clone(),
                c.running,
                c.duration_us,
                c.value_us,
                s.timestamp_us,
                c.alarm_unix_us,
            )
        })
        .collect()
}

fn add_error(err: AddError) -> fdo::Error {
    match err {
        AddError::TooMany => fdo::Error::LimitsExceeded(err.to_string()),
        AddError::BadLength | AddError::BadTime => fdo::Error::InvalidArgs(err.to_string()),
    }
}

fn properties(s: &Snapshot) -> PropertyList {
    vec![
        ("State", owned(s.state.as_str())),
        ("Phase", owned(s.phase.map_or("", Phase::as_str))),
        ("DurationUs", owned(s.duration_us)),
        ("RemainingUs", owned(s.remaining_us)),
        ("TimestampUs", owned(s.timestamp_us)),
        ("Sessions", owned(s.sessions)),
        ("LongBreak", owned(s.long_break)),
    ]
}

struct TimerInterface {
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<Snapshot>,
    clock_commands: mpsc::Sender<ClockCommand>,
    clocks: watch::Receiver<ClocksSnapshot>,
}

impl TimerInterface {
    async fn send(&self, command: Command) -> fdo::Result<()> {
        self.commands
            .send(command)
            .await
            .map_err(|_| fdo::Error::Failed("the timer has stopped".into()))
    }

    async fn send_clock(&self, command: ClockCommand) -> fdo::Result<()> {
        self.clock_commands
            .send(command)
            .await
            .map_err(|_| fdo::Error::Failed("the clocks have stopped".into()))
    }

    /// Sends an Add command built around the reply channel and waits for the id.
    async fn add(
        &self,
        command: impl FnOnce(oneshot::Sender<Result<String, AddError>>) -> ClockCommand,
    ) -> fdo::Result<String> {
        let (reply, rx) = oneshot::channel();
        self.send_clock(command(reply)).await?;
        rx.await
            .map_err(|_| fdo::Error::Failed("the clocks have stopped".into()))?
            .map_err(add_error)
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
    fn sessions(&self) -> u32 {
        self.state.borrow().sessions
    }

    #[zbus(property)]
    fn long_break(&self) -> bool {
        self.state.borrow().long_break
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

    #[zbus(property)]
    fn clocks(&self) -> Vec<ClockTuple> {
        clock_tuples(&self.clocks.borrow())
    }

    #[zbus(out_args("id"))]
    async fn add_countdown(&self, label: String, duration_us: i64) -> fdo::Result<String> {
        self.add(|reply| ClockCommand::AddCountdown {
            label,
            duration_us,
            reply,
        })
        .await
    }

    #[zbus(out_args("id"))]
    async fn add_stopwatch(&self, label: String) -> fdo::Result<String> {
        self.add(|reply| ClockCommand::AddStopwatch { label, reply })
            .await
    }

    #[zbus(out_args("id"))]
    async fn add_alarm(&self, label: String, unix_us: i64) -> fdo::Result<String> {
        self.add(|reply| ClockCommand::AddAlarm {
            label,
            unix_us,
            reply,
        })
        .await
    }

    async fn pause_clock(&self, id: String) -> fdo::Result<()> {
        self.send_clock(ClockCommand::Pause(id)).await
    }

    async fn resume_clock(&self, id: String) -> fdo::Result<()> {
        self.send_clock(ClockCommand::Resume(id)).await
    }

    async fn remove_clock(&self, id: String) -> fdo::Result<()> {
        self.send_clock(ClockCommand::Remove(id)).await
    }

    async fn clear_clocks(&self) -> fdo::Result<()> {
        self.send_clock(ClockCommand::Clear).await
    }

    #[zbus(signal)]
    async fn clock_done(
        emitter: &SignalEmitter<'_>,
        id: &str,
        kind: &str,
        label: &str,
    ) -> zbus::Result<()>;
}
