//! Samples the system every 2 s while someone watches, and turns memory
//! pressure into an alert while `[system] memory_alert` is on.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, watch};

use super::model::{cpu_usage, rate, AlertGate, CpuTimes, Usage, Watchers};
use crate::features::settings::SystemConfig;

/// Between two samples.
pub const INTERVAL: Duration = Duration::from_secs(2);
/// The first sample comes this soon after the first watch.
const FIRST: Duration = Duration::from_millis(500);

/// The counters at one moment; none for what the system does not tell.
#[derive(Clone, Copy, Debug, Default)]
pub struct Reading {
    pub cpu: Option<CpuTimes>,
    /// Used and total bytes.
    pub memory: Option<(u64, u64)>,
    /// °C.
    pub temperature: Option<f64>,
    /// Bytes received and sent since boot.
    pub net: Option<(u64, u64)>,
}

/// `io.nokta.System1.MemoryLow`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryLow {
    pub used: u64,
    pub total: u64,
    pub app: String,
}

/// Where the counters come from. Both calls block, briefly.
pub trait Source: Send + Sync + 'static {
    fn read(&self) -> Reading;
    /// Memory now, and the process using the most of it.
    fn memory_low(&self) -> MemoryLow;
}

/// Watches and unwatches, by D-Bus sender.
#[derive(Debug)]
pub enum Command {
    Watch(String),
    Unwatch(String),
    /// The sender left the bus.
    Gone(String),
}

pub struct Handle {
    pub commands: mpsc::Sender<Command>,
    pub usage: watch::Receiver<Usage>,
    pub memory_low: mpsc::Receiver<MemoryLow>,
}

/// Starts the service; `pressure` says each time memory runs short.
pub fn spawn(
    source: Arc<dyn Source>,
    config: watch::Receiver<SystemConfig>,
    mut pressure: mpsc::UnboundedReceiver<()>,
) -> Handle {
    let (commands, mut rx) = mpsc::channel(16);
    let (usage_tx, usage) = watch::channel(Usage::default());
    let (low_tx, memory_low) = mpsc::channel(4);
    tokio::spawn(async move {
        let mut watchers = Watchers::default();
        let mut gate = AlertGate::default();
        // The last reading and when it was taken, while sampling.
        let mut last: Option<(Instant, Reading)> = None;
        let mut next = tokio::time::Instant::now();
        loop {
            let sampling = last.is_some();
            tokio::select! {
                command = rx.recv() => {
                    let Some(command) = command else { break };
                    let running = match &command {
                        Command::Watch(sender) => watchers.add(sender),
                        Command::Unwatch(sender) => watchers.remove(sender),
                        Command::Gone(name) => watchers.drop_name(name),
                    };
                    if running && !sampling {
                        last = Some((Instant::now(), read(&source).await));
                        next = tokio::time::Instant::now() + FIRST;
                    } else if !running && sampling {
                        last = None;
                        usage_tx.send_replace(Usage::default());
                    }
                }
                () = tokio::time::sleep_until(next), if sampling => {
                    let now = read(&source).await;
                    let at = Instant::now();
                    if let Some((then, prev)) = last {
                        usage_tx.send_replace(sample(&prev, &now, at.duration_since(then)));
                    }
                    last = Some((at, now));
                    next += INTERVAL;
                }
                Some(()) = pressure.recv() => {
                    if config.borrow().memory_alert && gate.allow(Instant::now()) {
                        let source = source.clone();
                        if let Ok(low) = tokio::task::spawn_blocking(move || source.memory_low()).await {
                            let _ = low_tx.try_send(low);
                        }
                    }
                }
            }
        }
    });
    Handle {
        commands,
        usage,
        memory_low,
    }
}

async fn read(source: &Arc<dyn Source>) -> Reading {
    let source = source.clone();
    tokio::task::spawn_blocking(move || source.read())
        .await
        .unwrap_or_default()
}

/// The sample between two readings `elapsed` apart.
fn sample(prev: &Reading, now: &Reading, elapsed: Duration) -> Usage {
    let secs = elapsed.as_secs_f64();
    let (memory_used, memory_total) = now.memory.unwrap_or_default();
    let (download, upload) = match (prev.net, now.net) {
        (Some((rx0, tx0)), Some((rx1, tx1))) => (rate(rx0, rx1, secs), rate(tx0, tx1, secs)),
        _ => (0.0, 0.0),
    };
    Usage {
        cpu: match (prev.cpu, now.cpu) {
            (Some(a), Some(b)) => cpu_usage(&a, &b),
            _ => 0.0,
        },
        memory_used,
        memory_total,
        temperature: now.temperature.unwrap_or(f64::NAN),
        download,
        upload,
    }
}
