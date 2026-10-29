use std::f64::consts::TAU;
use std::time::{Duration, Instant};

use super::levels::*;

/// One frame of a sine at `hz`, `amplitude` of full scale, starting at frame `n`.
fn tone(hz: f64, amplitude: f64, n: usize) -> Vec<i16> {
    (0..FRAME)
        .map(|i| {
            let t = (n * FRAME + i) as f64 / f64::from(SAMPLE_RATE);
            (amplitude * f64::from(i16::MAX) * (TAU * hz * t).sin()).round() as i16
        })
        .collect()
}

fn loudest(levels: [f64; BANDS]) -> usize {
    (0..BANDS)
        .max_by(|&a, &b| levels[a].total_cmp(&levels[b]))
        .unwrap()
}

#[test]
fn a_100_hz_tone_fills_the_first_band() {
    let levels = Bands::new().frame(&tone(100.0, 0.5, 0));
    assert_eq!(loudest(levels), 0, "{levels:?}");
    assert!((levels[0] - 1.0).abs() < 1e-9, "{levels:?}");
    assert!(levels[1..].iter().all(|&l| l < 0.1), "{levels:?}");
}

#[test]
fn a_2_khz_tone_fills_the_third_band() {
    let levels = Bands::new().frame(&tone(2000.0, 0.5, 0));
    assert_eq!(loudest(levels), 2, "{levels:?}");
    assert!([0, 1, 3].iter().all(|&b| levels[b] < 0.1), "{levels:?}");
}

#[test]
fn silence_gives_no_levels() {
    let mut bands = Bands::new();
    assert_eq!(bands.frame(&[0; FRAME]), [0.0; BANDS]);
    // After music too: the peak is not a reason to show anything.
    bands.frame(&tone(100.0, 0.5, 0));
    assert_eq!(bands.frame(&[0; FRAME]), [0.0; BANDS]);
}

#[test]
fn the_peak_follows_the_music_down() {
    let mut bands = Bands::new();
    for n in 0..5 {
        bands.frame(&tone(100.0, 0.8, n));
    }
    let first = bands.frame(&tone(100.0, 0.2, 5))[0];
    assert!((first - 0.25).abs() < 0.02, "{first}");
    let later = (6..200)
        .map(|n| bands.frame(&tone(100.0, 0.2, n))[0])
        .last()
        .unwrap();
    assert!(later > 0.95, "{later}");
}

#[test]
fn capture_starts_when_wanted() {
    let mut life = Lifecycle::default();
    let now = Instant::now();
    assert_eq!(life.step(false, false, now), Step::Keep);
    assert_eq!(life.step(true, false, now), Step::Start);
    assert_eq!(life.step(true, true, now), Step::Keep);
}

#[test]
fn capture_stops_2_s_after_it_is_no_longer_wanted() {
    let mut life = Lifecycle::default();
    let now = Instant::now();
    assert_eq!(life.step(false, true, now), Step::Keep);
    assert_eq!(
        life.step(false, true, now + Duration::from_millis(1900)),
        Step::Keep
    );
    assert_eq!(life.step(false, true, now + LINGER), Step::Stop);
}

#[test]
fn wanted_again_within_2_s_keeps_capturing() {
    let mut life = Lifecycle::default();
    let now = Instant::now();
    life.step(false, true, now);
    assert_eq!(
        life.step(true, true, now + Duration::from_secs(1)),
        Step::Keep
    );
    // The 2 s count again from the next pause.
    let pause = now + Duration::from_millis(1500);
    assert_eq!(life.step(false, true, pause), Step::Keep);
    assert_eq!(life.step(false, true, now + LINGER), Step::Keep);
    assert_eq!(life.step(false, true, pause + LINGER), Step::Stop);
}

#[test]
fn a_failed_capture_waits_30_s() {
    let mut life = Lifecycle::default();
    let now = Instant::now();
    life.failed(now);
    assert_eq!(
        life.step(true, false, now + Duration::from_secs(29)),
        Step::Keep
    );
    assert_eq!(life.step(true, false, now + BACKOFF), Step::Start);
}
