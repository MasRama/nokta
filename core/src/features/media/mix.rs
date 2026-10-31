//! What Windows plays, as the bars hear it: the system's mix (any rate,
//! interleaved channels) turned into the 16 kHz mono frames `Bands`
//! takes. Pure, so it is tested on every system; `loopback.rs` records the
//! mix on Windows.

use super::levels::{FRAME, SAMPLE_RATE};

/// How the mix's samples are stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SampleKind {
    F32,
    I16,
}

/// `WAVE_FORMAT_PCM`, `WAVE_FORMAT_IEEE_FLOAT` and `WAVE_FORMAT_EXTENSIBLE`.
const PCM: u16 = 1;
const IEEE_FLOAT: u16 = 3;
const EXTENSIBLE: u16 = 0xFFFE;

/// The kind of a `WAVEFORMATEX` with `tag` and `bits` per sample;
/// `subformat` is the first field of an extensible one's `SubFormat`, which
/// holds the same codes as the tag. None for a kind the bars cannot read.
pub fn sample_kind(tag: u16, bits: u16, subformat: Option<u32>) -> Option<SampleKind> {
    let code = match tag {
        EXTENSIBLE => u16::try_from(subformat?).ok()?,
        tag => tag,
    };
    match (code, bits) {
        (IEEE_FLOAT, 32) => Some(SampleKind::F32),
        (PCM, 16) => Some(SampleKind::I16),
        _ => None,
    }
}

/// The samples in `bytes` from -1 to 1, little-endian as Windows keeps them.
pub fn samples(kind: SampleKind, bytes: &[u8]) -> Vec<f32> {
    match kind {
        SampleKind::F32 => bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&b| f32::from_le_bytes(b))
            .collect(),
        SampleKind::I16 => bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&b| f32::from(i16::from_le_bytes(b)) / 32_768.0)
            .collect(),
    }
}

/// Averages the channels into one and brings the rate down to
/// `SAMPLE_RATE`, averaging the samples each output sample stands for, then
/// cuts the result into frames of `FRAME`.
pub struct Downmix {
    channels: usize,
    /// The mix's rate; `owed` counts up by `SAMPLE_RATE` per input
    /// sample and pays out one output sample per `rate`, so no rate drifts.
    rate: u32,
    owed: u32,
    sum: f64,
    count: u32,
    pending: Vec<i16>,
}

impl Downmix {
    /// For a mix at `rate` Hz with `channels` channels.
    pub fn new(rate: u32, channels: u16) -> Downmix {
        Downmix {
            channels: usize::from(channels.max(1)),
            rate: rate.max(SAMPLE_RATE),
            owed: 0,
            sum: 0.0,
            count: 0,
            pending: Vec::with_capacity(FRAME),
        }
    }

    /// Takes interleaved samples; gives back each frame they complete.
    pub fn push(&mut self, interleaved: &[f32]) -> Vec<Vec<i16>> {
        let mut frames = Vec::new();
        for block in interleaved.chunks_exact(self.channels) {
            let mono = block.iter().map(|&s| f64::from(s)).sum::<f64>() / block.len() as f64;
            self.sum += mono;
            self.count += 1;
            self.owed += SAMPLE_RATE;
            if self.owed < self.rate {
                continue;
            }
            self.owed -= self.rate;
            let average = self.sum / f64::from(self.count);
            self.sum = 0.0;
            self.count = 0;
            self.pending
                .push((average.clamp(-1.0, 1.0) * 32_767.0).round() as i16);
            if self.pending.len() == FRAME {
                frames.push(std::mem::replace(
                    &mut self.pending,
                    Vec::with_capacity(FRAME),
                ));
            }
        }
        frames
    }
}

#[cfg(test)]
mod tests {
    use super::super::levels::Bands;
    use super::*;

    fn tone(hz: f64, rate: u32, seconds: f64, channels: usize) -> Vec<f32> {
        let count = (f64::from(rate) * seconds) as usize;
        (0..count)
            .flat_map(|i| {
                let s = (std::f64::consts::TAU * hz * i as f64 / f64::from(rate)).sin() * 0.5;
                std::iter::repeat_n(s as f32, channels)
            })
            .collect()
    }

    #[test]
    fn the_kinds_windows_mixes_in_are_read() {
        assert_eq!(sample_kind(3, 32, None), Some(SampleKind::F32));
        assert_eq!(sample_kind(1, 16, None), Some(SampleKind::I16));
        assert_eq!(sample_kind(0xFFFE, 32, Some(3)), Some(SampleKind::F32));
        assert_eq!(sample_kind(0xFFFE, 16, Some(1)), Some(SampleKind::I16));
        assert_eq!(sample_kind(1, 24, None), None);
        assert_eq!(sample_kind(0xFFFE, 32, None), None);
    }

    #[test]
    fn bytes_become_samples() {
        let float: Vec<u8> = [0.5f32, -1.0]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        assert_eq!(samples(SampleKind::F32, &float), vec![0.5, -1.0]);
        let pcm: Vec<u8> = [16_384i16, -32_768]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        assert_eq!(samples(SampleKind::I16, &pcm), vec![0.5, -1.0]);
    }

    #[test]
    fn a_second_of_the_mix_is_25_frames_at_any_rate() {
        for rate in [48_000, 44_100, 96_000, 16_000] {
            let mut mix = Downmix::new(rate, 2);
            let frames = mix.push(&tone(440.0, rate, 1.0, 2));
            assert_eq!(frames.len(), 25, "at {rate} Hz");
            assert!(frames.iter().all(|f| f.len() == FRAME));
        }
    }

    #[test]
    fn a_tone_lands_in_its_band() {
        let mut mix = Downmix::new(48_000, 2);
        let mut bands = Bands::new();
        let mut levels = [0.0; 4];
        for frame in mix.push(&tone(2_000.0, 48_000, 0.5, 2)) {
            levels = bands.frame(&frame);
        }
        // 2 kHz is in the third band, 1000-4000 Hz.
        assert!(levels[2] > 0.9, "{levels:?}");
        assert!(levels[0] < 0.2 && levels[3] < 0.2, "{levels:?}");
    }

    #[test]
    fn channels_out_of_phase_cancel() {
        let mut mix = Downmix::new(48_000, 2);
        let samples: Vec<f32> = (0..48_000)
            .flat_map(|i| {
                let s = ((i as f32) * 0.1).sin();
                [s, -s]
            })
            .collect();
        let frames = mix.push(&samples);
        assert!(frames.iter().flatten().all(|&s| s == 0));
    }
}
