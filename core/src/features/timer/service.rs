//! Owns the timer: takes commands, sleeps until the deadline and reports
//! finished phases. Nothing polls.

use std::time::Duration;

use tokio::sync::{mpsc, watch};

use super::logic::{Phase, Snapshot, Timer};
use crate::shared::clock::monotonic_us;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Start(Phase),
    Pause,
    Resume,
    Stop,
}

/// Starts the timer task. `length` gives a phase's length when it starts; a
/// phase of length zero does not start. Returns the command sender, the
/// published state and the finished phases.
pub fn spawn(
    length: impl Fn(Phase) -> Duration + Send + Sync + 'static,
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
        let start = |timer: &mut Timer, phase: Phase, now: i64| {
            let length = i64::try_from(length(phase).as_micros()).unwrap_or(i64::MAX);
            if length > 0 {
                timer.start(phase, length, now);
            }
            length > 0
        };
        loop {
            let wait = timer
                .deadline()
                .map(|deadline| Duration::from_micros((deadline - monotonic_us()).max(0) as u64));
            let changed = tokio::select! {
                command = rx.recv() => {
                    let now = monotonic_us();
                    match command {
                        None => break,
                        Some(Command::Start(phase)) => start(&mut timer, phase, now),
                        Some(Command::Pause) => timer.pause(now),
                        Some(Command::Resume) => timer.resume(now),
                        Some(Command::Stop) => timer.stop(),
                    }
                }
                () = sleep(wait) => {
                    let now = monotonic_us();
                    let ended = timer.expire(now);
                    if let Some(phase) = ended {
                        tracing::info!("{} finished", phase.as_str());
                        if phase == Phase::Focus {
                            start(&mut timer, Phase::Break, now);
                        }
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
