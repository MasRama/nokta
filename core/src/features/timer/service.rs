//! Owns the timer: takes commands, sleeps until the deadline and reports
//! finished phases. Nothing polls.

use tokio::sync::{mpsc, oneshot, watch};

use super::clocks::{AddError, ClockView, Clocks, Done};
use super::logic::{Lengths, Phase, Snapshot, Timer};
use crate::shared::clock::{monotonic_us, sleep_for, until_monotonic, wait_us};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Start(Phase),
    Pause,
    Resume,
    Stop,
}

/// Starts the timer task. `lengths` is read whenever a phase starts; a
/// phase of length zero does not start. Returns the command sender, the
/// published state and the finished phases.
pub fn spawn(
    lengths: impl Fn() -> Lengths + Send + Sync + 'static,
) -> (
    mpsc::Sender<Command>,
    watch::Receiver<Snapshot>,
    mpsc::Receiver<Phase>,
) {
    let (commands, mut rx) = mpsc::channel(16);
    let (state_tx, state) = watch::channel(Snapshot::default());
    let (finished_tx, finished) = mpsc::channel(16);
    tokio::spawn(async move {
        let mut timer = Timer::default();
        loop {
            let wait = timer.deadline().map(until_monotonic);
            let changed = tokio::select! {
                command = rx.recv() => {
                    let now = monotonic_us();
                    match command {
                        None => break,
                        Some(Command::Start(phase)) => timer.start(phase, &lengths(), now),
                        Some(Command::Pause) => timer.pause(now),
                        Some(Command::Resume) => timer.resume(now),
                        Some(Command::Stop) => timer.stop(),
                    }
                }
                () = sleep_for(wait) => {
                    let now = monotonic_us();
                    let ended = timer.expire(now, &lengths());
                    if let Some(phase) = ended {
                        tracing::info!("{} finished", phase.as_str());
                        let _ = finished_tx.send(phase).await;
                    }
                    ended.is_some()
                }
            };
            // Only real changes: a new snapshot of an unchanged timer would
            // only move its timestamp.
            if changed {
                state_tx.send_replace(timer.snapshot(monotonic_us()));
            }
        }
    });
    (commands, state, finished)
}

type Reply = oneshot::Sender<Result<String, AddError>>;

pub enum ClockCommand {
    AddCountdown {
        label: String,
        duration_us: i64,
        reply: Reply,
    },
    AddStopwatch {
        label: String,
        reply: Reply,
    },
    AddAlarm {
        label: String,
        unix_us: i64,
        reply: Reply,
    },
    Pause(String),
    Resume(String),
    Remove(String),
    Clear,
    /// The system woke from suspend: read the wall clock again.
    Wake,
}

/// What `io.nokta.Timer1.Clocks` publishes: the values at `timestamp_us`
/// (monotonic).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ClocksSnapshot {
    pub clocks: Vec<ClockView>,
    pub timestamp_us: i64,
}

/// The clocks task's command sender, published clocks and finished clocks.
pub struct ClocksHandle {
    pub commands: mpsc::Sender<ClockCommand>,
    pub state: watch::Receiver<ClocksSnapshot>,
    pub done: mpsc::Receiver<Done>,
}

/// Starts the clocks task. `wall` reads the wall clock in Unix
/// microseconds. Returns the command sender, the published clocks and the
/// countdowns and alarms that are done.
pub fn spawn_clocks(
    wall: impl Fn() -> i64 + Send + 'static,
) -> (
    mpsc::Sender<ClockCommand>,
    watch::Receiver<ClocksSnapshot>,
    mpsc::Receiver<Done>,
) {
    let (commands, mut rx) = mpsc::channel(16);
    let (state_tx, state) = watch::channel(ClocksSnapshot::default());
    let (done_tx, done) = mpsc::channel(16);
    tokio::spawn(async move {
        let mut clocks = Clocks::default();
        loop {
            // Sleeps on the monotonic clock; a wall clock that moves under
            // it, as after a suspend, is caught by Wake.
            let wait = clocks.next_due(wall()).map(wait_us);
            let changed = tokio::select! {
                command = rx.recv() => {
                    let now = wall();
                    match command {
                        None => break,
                        Some(ClockCommand::AddCountdown { label, duration_us, reply }) => {
                            answer(reply, clocks.add_countdown(&label, duration_us, now))
                        }
                        Some(ClockCommand::AddStopwatch { label, reply }) => {
                            answer(reply, clocks.add_stopwatch(&label, now))
                        }
                        Some(ClockCommand::AddAlarm { label, unix_us, reply }) => {
                            answer(reply, clocks.add_alarm(&label, unix_us, now))
                        }
                        Some(ClockCommand::Pause(id)) => clocks.pause(&id, now),
                        Some(ClockCommand::Resume(id)) => clocks.resume(&id, now),
                        Some(ClockCommand::Remove(id)) => clocks.remove(&id),
                        Some(ClockCommand::Clear) => clocks.clear(),
                        Some(ClockCommand::Wake) => true,
                    }
                }
                () = sleep_for(wait) => false,
            };
            let done = clocks.expire(wall());
            let expired = !done.is_empty();
            for clock in done {
                tracing::info!("{} {} done", clock.kind.as_str(), clock.id);
                let _ = done_tx.send(clock).await;
            }
            if changed || expired {
                state_tx.send_replace(ClocksSnapshot {
                    clocks: clocks.views(wall()),
                    timestamp_us: monotonic_us(),
                });
            }
        }
    });
    (commands, state, done)
}

/// Sends the result back and says whether a clock was added.
fn answer(reply: Reply, result: Result<String, AddError>) -> bool {
    let added = result.is_ok();
    let _ = reply.send(result);
    added
}
