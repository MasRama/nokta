//! The bars that follow the music: four band levels from what plays, and
//! when to record it.

use std::time::{Duration, Instant};

/// What noktad records: 16 kHz mono, signed 16-bit.
pub const SAMPLE_RATE: u32 = 16_000;
/// Samples per level: 40 ms, so 25 levels a second.
pub const FRAME: usize = 640;
pub const BANDS: usize = 4;
/// The bands' edges in Hz: 60-250, 250-1000, 1000-4000 and 4000-8000.
const EDGES: [f64; BANDS + 1] = [60.0, 250.0, 1000.0, 4000.0, 8000.0];
/// The peak halves in about 2 s (50 frames), so a quiet song fills the bars again.
const DECAY: f64 = 0.986_23;
/// Below this a frame is silence (about -60 dB of a full-scale tone's band).
const FLOOR: f64 = 0.16;

/// Recording goes on this long after the music stops, for a short pause.
pub const LINGER: Duration = Duration::from_secs(2);
/// After the recorder fails, noktad waits this long before trying again.
pub const BACKOFF: Duration = Duration::from_secs(30);

/// Turns frames of samples into band levels from 0 to 1, against a peak
/// that follows the music down.
pub struct Bands {
    /// A cosine over one frame, indexed by `k * n % FRAME`.
    cos: Vec<f64>,
    window: Vec<f64>,
    peak: f64,
}

impl Default for Bands {
    fn default() -> Self {
        Bands::new()
    }
}

impl Bands {
    pub fn new() -> Bands {
        let angle = |i: usize| std::f64::consts::TAU * i as f64 / FRAME as f64;
        Bands {
            cos: (0..FRAME).map(|i| angle(i).cos()).collect(),
            window: (0..FRAME).map(|i| 0.5 - 0.5 * angle(i).cos()).collect(),
            peak: 0.0,
        }
    }

    /// The levels of one frame of `FRAME` samples; silence gives zeros.
    pub fn frame(&mut self, samples: &[i16]) -> [f64; BANDS] {
        let input: Vec<f64> = samples
            .iter()
            .zip(&self.window)
            .map(|(&s, w)| f64::from(s) / 32_768.0 * w)
            .collect();
        let bin_hz = f64::from(SAMPLE_RATE) / FRAME as f64;
        let mut values = [0.0; BANDS];
        for (band, value) in values.iter_mut().enumerate() {
            let first = (EDGES[band] / bin_hz).ceil() as usize;
            let end = (EDGES[band + 1] / bin_hz).ceil() as usize;
            let power: f64 = (first..end).map(|k| self.power(&input, k)).sum();
            *value = power.sqrt();
        }
        let loudest = values.iter().copied().fold(0.0, f64::max);
        self.peak = (self.peak * DECAY).max(loudest);
        if loudest < FLOOR {
            return [0.0; BANDS];
        }
        values.map(|v| (v / self.peak).clamp(0.0, 1.0))
    }

    /// The power of DFT bin `k`.
    fn power(&self, input: &[f64], k: usize) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (n, x) in input.iter().enumerate() {
            let i = k * n % FRAME;
            re += x * self.cos[i];
            // sin(a) = cos(a - a quarter turn).
            im -= x * self.cos[(i + FRAME - FRAME / 4) % FRAME];
        }
        re * re + im * im
    }
}

/// What to do with the recorder now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Start,
    Stop,
    Keep,
}

/// When to record: while the bars are wanted, until `LINGER` after they
/// no longer are, and not again until `BACKOFF` after a failure.
#[derive(Default)]
pub struct Lifecycle {
    unwanted_since: Option<Instant>,
    retry_at: Option<Instant>,
}

impl Lifecycle {
    /// `wanted` is the setting on and a player playing; `running` whether
    /// the recorder runs.
    pub fn step(&mut self, wanted: bool, running: bool, now: Instant) -> Step {
        if wanted {
            self.unwanted_since = None;
            if running || self.retry_at.is_some_and(|at| now < at) {
                return Step::Keep;
            }
            self.retry_at = None;
            return Step::Start;
        }
        if !running {
            self.unwanted_since = None;
            return Step::Keep;
        }
        let since = *self.unwanted_since.get_or_insert(now);
        if now.duration_since(since) < LINGER {
            return Step::Keep;
        }
        self.unwanted_since = None;
        Step::Stop
    }

    /// The recorder could not start or quit on its own.
    pub fn failed(&mut self, now: Instant) {
        self.retry_at = Some(now + BACKOFF);
        self.unwanted_since = None;
    }
}
