//! Records what Windows plays (WASAPI loopback on the default output) while
//! the bars should follow it, and turns it into band levels: the Windows
//! twin of `capture.rs`, with a thread in place of `pw-record`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, oneshot, watch};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
};

use super::levels::{Bands, Lifecycle, Silence, Step, BANDS};
use super::mix::{sample_kind, samples as decode, Downmix, SampleKind};
use super::{MediaState, PlaybackStatus};
use crate::shared::clock::sleep_for;

/// How often the recorder takes what has played: two frames' worth.
const POLL: Duration = Duration::from_millis(20);
/// The shared buffer Windows keeps for the recorder, in 100 ns units: 200 ms.
const BUFFER: i64 = 2_000_000;

/// Records while `enabled(settings)` and a player plays, and sends the
/// levels it hears. Runs until the receiver is dropped.
pub fn spawn<T: Send + Sync + 'static>(
    media: watch::Receiver<MediaState>,
    settings: watch::Receiver<T>,
    enabled: fn(&T) -> bool,
) -> mpsc::Receiver<[f64; BANDS]> {
    let (tx, rx) = mpsc::channel(8);
    tokio::spawn(run(media, settings, enabled, tx));
    rx
}

struct Recorder {
    stop: Arc<AtomicBool>,
    done: oneshot::Receiver<()>,
}

impl Recorder {
    fn stop(self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// As `capture::run`: wakes only when something can change the answer.
async fn run<T>(
    mut media: watch::Receiver<MediaState>,
    mut settings: watch::Receiver<T>,
    enabled: fn(&T) -> bool,
    tx: mpsc::Sender<[f64; BANDS]>,
) {
    let mut life = Lifecycle::default();
    let mut recorder: Option<Recorder> = None;
    loop {
        let now = Instant::now();
        if let Some(r) = recorder.as_mut() {
            if r.done.try_recv() != Err(oneshot::error::TryRecvError::Empty) {
                recorder = None;
                tracing::warn!("the loopback recorder stopped; the bars try again in 30 s");
                life.failed(now);
            }
        }
        let wanted = enabled(&settings.borrow_and_update())
            && media.borrow_and_update().status == PlaybackStatus::Playing;
        match life.step(wanted, recorder.is_some(), now) {
            Step::Start => recorder = Some(start(tx.clone())),
            Step::Stop => {
                if let Some(r) = recorder.take() {
                    r.stop();
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
        r.stop();
    }
}

/// Resolves when the recorder's thread ends; never without a recorder.
async fn quits(recorder: Option<&mut Recorder>) {
    match recorder {
        Some(r) => {
            let _ = (&mut r.done).await;
        }
        None => std::future::pending().await,
    }
}

fn start(tx: mpsc::Sender<[f64; BANDS]>) -> Recorder {
    let stop = Arc::new(AtomicBool::new(false));
    let (done, finished) = oneshot::channel();
    let flag = stop.clone();
    let spawned = std::thread::Builder::new()
        .name("nokta-levels".into())
        .spawn(move || {
            if let Err(err) = record(&flag, &tx) {
                tracing::warn!("cannot record what plays: {err}");
            }
            let _ = done.send(());
        });
    if let Err(err) = spawned {
        tracing::warn!("cannot start the loopback recorder: {err}");
    }
    Recorder {
        stop,
        done: finished,
    }
}

/// Records the default output until `stop`, or until Windows fails it
/// (the output changed, say): then the lifecycle starts it again.
fn record(stop: &AtomicBool, tx: &mpsc::Sender<[f64; BANDS]>) -> windows::core::Result<()> {
    // SAFETY: COM on this thread only, set up before any call; the mix
    // format is read while Windows owns it and freed once.
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = devices.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
        let format = client.GetMixFormat()?;
        // The struct is packed: its fields are copied out, never borrowed.
        let head: WAVEFORMATEX = std::ptr::read_unaligned(format);
        let (tag, bits, rate, channels, block, extra) = (
            head.wFormatTag,
            head.wBitsPerSample,
            head.nSamplesPerSec,
            head.nChannels,
            head.nBlockAlign,
            head.cbSize,
        );
        let subformat = (tag == 0xFFFE && extra >= 22).then(|| {
            let full: WAVEFORMATEXTENSIBLE =
                std::ptr::read_unaligned(format.cast::<WAVEFORMATEXTENSIBLE>());
            let guid = full.SubFormat;
            guid.data1
        });
        let initialized = client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            BUFFER,
            0,
            format,
            None,
        );
        CoTaskMemFree(Some(format.cast_const().cast()));
        initialized?;
        let Some(kind) = sample_kind(tag, bits, subformat) else {
            tracing::info!(
                tag,
                bits,
                "the output's mix format is one the bars cannot read"
            );
            return Ok(());
        };
        let capture: IAudioCaptureClient = client.GetService()?;
        client.Start()?;
        let read = drain(
            &capture,
            kind,
            Downmix::new(rate, channels),
            usize::from(block),
            stop,
            tx,
        );
        let _ = client.Stop();
        read
    }
}

/// Takes what has played every `POLL` until `stop`; `capture` is started,
/// with frames of `block` bytes of `kind`.
fn drain(
    capture: &IAudioCaptureClient,
    kind: SampleKind,
    mut mix: Downmix,
    block: usize,
    stop: &AtomicBool,
    tx: &mpsc::Sender<[f64; BANDS]>,
) -> windows::core::Result<()> {
    let mut bands = Bands::new();
    let mut silence = Silence::default();
    while !stop.load(Ordering::Relaxed) && !tx.is_closed() {
        std::thread::sleep(POLL);
        loop {
            // SAFETY: the buffer holds `frames` frames of `block` bytes until
            // it is released, after it is copied.
            let samples = unsafe {
                if capture.GetNextPacketSize()? == 0 {
                    break;
                }
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
                let bytes = frames as usize * block;
                let samples =
                    if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                        vec![0.0; bytes / kind_size(kind)]
                    } else {
                        decode(kind, std::slice::from_raw_parts(data, bytes))
                    };
                capture.ReleaseBuffer(frames)?;
                samples
            };
            for frame in mix.push(&samples) {
                let levels = bands.frame(&frame);
                // A slow listener misses levels rather than getting them late.
                if silence.pass(&levels, Instant::now()) {
                    let _ = tx.try_send(levels);
                }
            }
        }
    }
    Ok(())
}

fn kind_size(kind: SampleKind) -> usize {
    match kind {
        SampleKind::F32 => 4,
        SampleKind::I16 => 2,
    }
}
