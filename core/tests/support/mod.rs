//! Shared helpers for integration tests that need a D-Bus session bus.
#![allow(dead_code)]

pub mod bus;
pub mod daemon;
pub mod fake_devices;
pub mod fake_packagekit;
pub mod fake_player;

use std::time::Duration;

use tokio::sync::watch;

/// Waits until the watched value satisfies `pred`, failing after 5 s.
pub async fn wait_for<T: Clone + std::fmt::Debug>(
    rx: &mut watch::Receiver<T>,
    what: &str,
    pred: impl FnMut(&T) -> bool,
) -> T {
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        rx.wait_for(pred).await.map(|v| v.clone())
    })
    .await;
    match result {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => panic!("watch channel closed while waiting for {what}"),
        Err(_) => panic!(
            "timed out waiting for {what}; last value: {:?}",
            *rx.borrow()
        ),
    }
}
