//! Owns the timer: takes commands, sleeps until the deadline and reports
//! finished phases. Nothing polls.

use std::time::Duration;

use tokio::sync::{mpsc, watch};

use super::logic::{Lengths, Phase, Snapshot, Timer};
use crate::shared::clock::monotonic_us;

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
            let wait = timer
                .deadline()
                .map(|deadline| Duration::from_micros((deadline - monotonic_us()).max(0) as u64));
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
                () = sleep(wait) => {
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

/// Sleeps for `wait`, or forever without one.
async fn sleep(wait: Option<Duration>) {
    match wait {
        Some(wait) => tokio::time::sleep(wait).await,
        None => std::future::pending().await,
    }
}
