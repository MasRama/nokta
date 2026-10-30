//! Keeps `UpdateState`. With `[updates] check` it asks 30 s after start and
//! then once a day, by the wall clock: a suspend that passes the deadline
//! asks on resume. `Check` asks now. A failed request keeps what was known
//! and waits for the next deadline.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use tokio::sync::{mpsc, watch};

use super::github::{Client, FetchError, Release};
use super::model::{newer, DAY_US, FIRST_CHECK_US};
use super::UpdateState;
use crate::features::settings::UpdatesConfig;
use crate::shared::clock::{sleep_for, wait_us};

/// Where releases come from. Implemented by the GitHub client; tests inject fakes.
pub trait ReleaseSource: Send + Sync {
    fn latest(&self) -> BoxFuture<'_, Result<Release, FetchError>>;
}

impl ReleaseSource for Client {
    fn latest(&self) -> BoxFuture<'_, Result<Release, FetchError>> {
        Box::pin(Client::latest(self))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    /// Ask GitHub now.
    Check,
}

pub struct Handle {
    pub commands: mpsc::Sender<Command>,
    pub state: watch::Receiver<UpdateState>,
}

/// `current` is the running version; `resumes` counts resumes from
/// suspend; `now` reads the wall clock in microseconds.
pub fn spawn(
    config: watch::Receiver<UpdatesConfig>,
    source: Arc<dyn ReleaseSource>,
    current: &str,
    resumes: watch::Receiver<u64>,
    now: impl Fn() -> i64 + Send + Sync + 'static,
) -> Handle {
    let (commands, requests) = mpsc::channel(4);
    let (tx, state) = watch::channel(UpdateState::default());
    tokio::spawn(run(
        config,
        requests,
        source,
        current.to_owned(),
        resumes,
        now,
        tx,
    ));
    Handle { commands, state }
}

async fn run(
    mut config: watch::Receiver<UpdatesConfig>,
    mut requests: mpsc::Receiver<Command>,
    source: Arc<dyn ReleaseSource>,
    current: String,
    mut resumes: watch::Receiver<u64>,
    now: impl Fn() -> i64,
    tx: watch::Sender<UpdateState>,
) {
    let mut check = config.borrow_and_update().check;
    let mut due = now() + FIRST_CHECK_US;
    let mut hears_resumes = true;
    loop {
        // Measured again each turn, so a resume sees the time spent asleep.
        let wait = check.then(|| wait_us(due - now()));
        tokio::select! {
            () = sleep_for(wait) => {
                ask(source.as_ref(), &current, &tx).await;
                due = now() + DAY_US;
            }
            changed = config.changed() => {
                if changed.is_err() {
                    return;
                }
                let next = config.borrow_and_update().check;
                if next != check {
                    check = next;
                    if check {
                        ask(source.as_ref(), &current, &tx).await;
                        due = now() + DAY_US;
                    } else {
                        tx.send_replace(UpdateState::default());
                    }
                }
            }
            request = requests.recv() => match request {
                Some(Command::Check) => {
                    ask(source.as_ref(), &current, &tx).await;
                    due = now() + DAY_US;
                }
                None => return,
            },
            resumed = resumes.changed(), if hears_resumes => {
                hears_resumes = resumed.is_ok();
            }
        }
    }
}

async fn ask(source: &dyn ReleaseSource, current: &str, tx: &watch::Sender<UpdateState>) {
    match source.latest().await {
        Ok(release) => {
            let state = match newer(current, &release.tag) {
                Some(latest) => UpdateState {
                    latest,
                    url: release.url,
                },
                None => UpdateState::default(),
            };
            tx.send_if_modified(|s| {
                let changed = *s != state;
                *s = state;
                changed
            });
        }
        Err(err) => tracing::warn!("cannot check for a newer Nokta: {err:#}"),
    }
}
