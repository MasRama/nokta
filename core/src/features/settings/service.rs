//! Publishes the current config and reloads it when the file changes.

use tokio::sync::{mpsc, watch};

use super::{Config, Store};

/// `changes` yields once per (debounced) change of the config file.
pub fn spawn(mut store: Store, mut changes: mpsc::Receiver<()>) -> watch::Receiver<Config> {
    let (tx, rx) = watch::channel(store.current().clone());
    tokio::spawn(async move {
        while changes.recv().await.is_some() {
            match store.reload() {
                Ok(true) => {
                    tracing::info!("{}: reloaded", store.path().display());
                    tx.send_replace(store.current().clone());
                }
                Ok(false) => {}
                Err(err) => tracing::error!(
                    "{}: {err}; keeping the last valid config",
                    store.path().display()
                ),
            }
        }
    });
    rx
}
