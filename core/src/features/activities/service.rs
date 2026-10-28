//! Owns the activities: takes commands, ends stale ones at their deadline
//! and reports every activity that ended. Nothing polls.

use std::time::Duration;

use tokio::sync::{mpsc, oneshot, watch};

use super::model::{Activities, Activity, Ended, SetError, Update};
use crate::shared::clock::monotonic_us;

#[derive(Debug)]
pub enum Command {
    Set {
        id: String,
        update: Update,
        reply: oneshot::Sender<Result<(), SetError>>,
    },
    End {
        id: String,
        success: bool,
        message: String,
    },
}

/// The service's commands, its published list and the activities that ended.
pub struct Handle {
    pub commands: mpsc::Sender<Command>,
    pub state: watch::Receiver<Vec<Activity>>,
    pub ended: mpsc::Receiver<Ended>,
}

/// Starts the service; `stale_us` is read whenever a deadline is worked out.
pub fn spawn(stale_us: impl Fn() -> i64 + Send + Sync + 'static) -> Handle {
    let (commands, mut rx) = mpsc::channel(32);
    let (state_tx, state) = watch::channel(Vec::new());
    let (ended_tx, ended) = mpsc::channel(32);
    tokio::spawn(async move {
        let mut activities = Activities::default();
        loop {
            let stale = stale_us();
            let wait = activities
                .next_deadline(stale)
                .map(|deadline| Duration::from_micros((deadline - monotonic_us()).max(0) as u64));
            let ended: Vec<Ended> = tokio::select! {
                command = rx.recv() => match command {
                    None => break,
                    Some(Command::Set { id, update, reply }) => {
                        let result = activities.set(&id, update, monotonic_us());
                        let replaced = result.as_ref().ok().cloned().flatten();
                        let _ = reply.send(result.map(|_| ()));
                        replaced.into_iter().collect()
                    }
                    Some(Command::End { id, success, message }) => {
                        activities.end(&id, success, &message, monotonic_us()).into_iter().collect()
                    }
                },
                () = sleep(wait) => activities.expire(monotonic_us(), stale),
            };
            state_tx.send_if_modified(|list| {
                let changed = list.as_slice() != activities.list();
                if changed {
                    *list = activities.list().to_vec();
                }
                changed
            });
            for activity in ended {
                tracing::info!(id = %activity.id, success = activity.success, "activity ended");
                let _ = ended_tx.send(activity).await;
            }
        }
    });
    Handle {
        commands,
        state,
        ended,
    }
}

/// Sleeps for `wait`, or forever without one.
async fn sleep(wait: Option<Duration>) {
    match wait {
        Some(wait) => tokio::time::sleep(wait).await,
        None => std::future::pending().await,
    }
}
