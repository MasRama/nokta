//! Records what plays with `pw-record` while the bars should follow it,
//! and turns it into band levels.

use std::io;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::levels::{Bands, Lifecycle, Step, BANDS, FRAME};
use super::{MediaState, PlaybackStatus};
use crate::shared::clock::sleep_for;

/// While it is silent, the zero levels go out this often instead of 25 times a second.
const SILENT_EVERY: Duration = Duration::from_millis(500);
/// How long `pw-record --help` may take.
const HELP_LIMIT: Duration = Duration::from_secs(2);
/// The default output's monitor, as 16 kHz mono s16 on stdout. The stream
/// is named, so Nokta can tell it from an app on a call.
const ARGS: [&str; 8] = [
    "--rate",
    "16000",
    "--channels",
    "1",
    "--format",
    "s16",
    "-P",
    "{ application.id = io.nokta.Nokta application.name = Nokta node.name = nokta-levels \
     stream.capture.sink = true }",
];

/// Records with `program` while `enabled(settings)` and a player plays,
/// and sends the levels it hears. Runs until the receiver is dropped.
pub fn spawn<T: Send + Sync + 'static>(
    program: String,
    media: watch::Receiver<MediaState>,
    settings: watch::Receiver<T>,
    enabled: fn(&T) -> bool,
) -> mpsc::Receiver<[f64; BANDS]> {
    let (tx, rx) = mpsc::channel(8);
    tokio::spawn(run(program, media, settings, enabled, tx));
    rx
}

struct Recorder {
    child: Child,
    reader: JoinHandle<()>,
}

impl Recorder {
    async fn stop(mut self) {
        self.reader.abort();
        // Also waits for it, so it leaves no zombie.
        let _ = self.child.kill().await;
    }
}

/// Wakes only when something can change the answer: the player, the
/// setting, the recorder quitting, or the end of a linger or backoff.
async fn run<T>(
    program: String,
    mut media: watch::Receiver<MediaState>,
    mut settings: watch::Receiver<T>,
    enabled: fn(&T) -> bool,
    tx: mpsc::Sender<[f64; BANDS]>,
) {
    let mut life = Lifecycle::default();
    let mut recorder: Option<Recorder> = None;
    let mut told_missing = false;
    let mut raw: Option<bool> = None;
    loop {
        let now = Instant::now();
        if recorder.as_ref().is_some_and(|r| r.reader.is_finished()) {
            if let Some(r) = recorder.take() {
                r.stop().await;
            }
            tracing::warn!("{program} stopped; the bars try again in 30 s");
            life.failed(now);
        }
        let wanted = enabled(&settings.borrow_and_update())
            && media.borrow_and_update().status == PlaybackStatus::Playing;
        match life.step(wanted, recorder.is_some(), now) {
            Step::Start => match start(&program, takes_raw(&program, &mut raw).await, tx.clone()) {
                Ok(started) => recorder = Some(started),
                Err(err) => {
                    if err.kind() != io::ErrorKind::NotFound {
                        tracing::warn!(%err, "cannot start {program}");
                    } else if !told_missing {
                        tracing::info!("no {program}: the bars keep their pattern");
                        told_missing = true;
                    }
                    life.failed(now);
                }
            },
            Step::Stop => {
                if let Some(r) = recorder.take() {
                    r.stop().await;
                }
            }
            Step::Keep => {}
        }
        let wake = life.wake_at(Instant::now());
        tokio::select! {
            () = tx.closed() => break,
            changed = media.changed() => if changed.is_err() { break },
            changed = settings.changed() => if changed.is_err() { break },
            () = quits(recorder.as_mut()) => {}
            () = sleep_for(wake.map(|at| at.saturating_duration_since(Instant::now()))) => {}
        }
    }
    if let Some(r) = recorder {
        r.stop().await;
    }
}

/// Resolves when the recorder's reader ends; never without a recorder.
async fn quits(recorder: Option<&mut Recorder>) {
    match recorder {
        Some(r) => {
            let _ = (&mut r.reader).await;
        }
        None => std::future::pending().await,
    }
}

/// Whether `program` needs `--raw` to write bare samples to `-`: from
/// PipeWire 1.4 on it otherwise writes a sound file there (WAV, or from 1.6
/// big-endian AU). Older ones have no such flag. Asked once, when it runs.
async fn takes_raw(program: &str, known: &mut Option<bool>) -> bool {
    if let Some(raw) = *known {
        return raw;
    }
    let help = Command::new(program)
        .arg("--help")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(HELP_LIMIT, help).await {
        Ok(Ok(out)) => {
            let raw = String::from_utf8_lossy(&out.stdout).contains("--raw");
            *known = Some(raw);
            raw
        }
        // Not there yet, or stuck: ask again next time.
        _ => false,
    }
}

fn start(program: &str, raw: bool, tx: mpsc::Sender<[f64; BANDS]>) -> io::Result<Recorder> {
    let mut child = Command::new(program)
        .args(ARGS)
        .args(raw.then_some("--raw"))
        .arg("-")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let reader = tokio::spawn(async move {
        let mut bands = Bands::new();
        let mut bytes = vec![0u8; FRAME * 2];
        let mut silent_since: Option<Instant> = None;
        while stdout.read_exact(&mut bytes).await.is_ok() {
            let samples: Vec<i16> = (0..FRAME)
                .map(|i| i16::from_le_bytes([bytes[2 * i], bytes[2 * i + 1]]))
                .collect();
            let levels = bands.frame(&samples);
            if levels == [0.0; BANDS] {
                let now = Instant::now();
                if silent_since.is_some_and(|at| now.duration_since(at) < SILENT_EVERY) {
                    continue;
                }
                silent_since = Some(now);
            } else {
                silent_since = None;
            }
            // A slow listener misses levels rather than getting them late.
            let _ = tx.try_send(levels);
        }
    });
    Ok(Recorder { child, reader })
}
