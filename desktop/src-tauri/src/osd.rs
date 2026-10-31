//! What Windows' own OSD would show, for the notch's `Osd1.Show`: the volume
//! and the brightness as the keys change them, the lock keys and the
//! keyboard layout. Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

/// How long after a volume key a volume change counts as the key's, in ms.
pub const KEY_WINDOW_MS: u64 = 1500;
/// The least brightness step that shows, in percent points: the ambient
/// light sensor moves it in smaller ones.
pub const BRIGHTNESS_STEP: u8 = 5;

/// One thing for the notch to show.
#[derive(Debug, Clone, PartialEq)]
pub enum Osd {
    /// From 0 to 1.
    Volume(f64),
    Muted,
    /// From 0 to 1.
    Brightness(f64),
    CapsLock(bool),
    NumLock(bool),
    /// The layout's language, as the user reads it.
    Layout(String),
}

impl Osd {
    /// The `kind` argument of `Osd1.Show`.
    pub fn kind(&self) -> &'static str {
        match self {
            Osd::Volume(_) => "volume",
            Osd::Muted => "muted",
            Osd::Brightness(_) => "brightness",
            Osd::CapsLock(_) => "caps-lock",
            Osd::NumLock(_) => "num-lock",
            Osd::Layout(_) => "layout",
        }
    }

    /// The `level` argument: the fraction, 1 or 0 for a lock key, -1 where
    /// there is none.
    pub fn level(&self) -> f64 {
        match self {
            Osd::Volume(level) | Osd::Brightness(level) => *level,
            Osd::Muted => 0.0,
            Osd::CapsLock(on) | Osd::NumLock(on) => f64::from(u8::from(*on)),
            Osd::Layout(_) => -1.0,
        }
    }

    /// The `name` argument: the layout's, else empty.
    pub fn name(&self) -> &str {
        match self {
            Osd::Layout(name) => name,
            _ => "",
        }
    }
}

/// The volume as Windows reports it, as shown.
pub fn volume(level: f32, muted: bool) -> Osd {
    if muted {
        Osd::Muted
    } else {
        Osd::Volume(hundredths(f64::from(level)))
    }
}

/// Whether a volume change at `now` follows a volume key pressed at
/// `pressed`, both in ms since boot; 0 is never.
pub fn after_volume_key(pressed: u64, now: u64) -> bool {
    pressed != 0 && now.saturating_sub(pressed) <= KEY_WINDOW_MS
}

/// The language of a keyboard layout (`HKL`): its low word.
pub fn layout_language(layout: isize) -> u32 {
    (layout as usize & 0xffff) as u32
}

fn hundredths(level: f64) -> f64 {
    (level.clamp(0.0, 1.0) * 100.0).round() / 100.0
}

/// Caps Lock and Num Lock as last read.
#[derive(Debug, Default)]
pub struct Locks {
    caps: Option<bool>,
    num: Option<bool>,
}

impl Locks {
    /// Takes the lock keys as read now and gives what changed since the
    /// last read. The first read only learns where they are.
    pub fn update(&mut self, caps: bool, num: bool) -> Vec<Osd> {
        let mut changed = Vec::new();
        if self.caps.is_some_and(|was| was != caps) {
            changed.push(Osd::CapsLock(caps));
        }
        if self.num.is_some_and(|was| was != num) {
            changed.push(Osd::NumLock(num));
        }
        self.caps = Some(caps);
        self.num = Some(num);
        changed
    }
}

/// The foreground window and its keyboard layout as last read.
#[derive(Debug, Default)]
pub struct Layouts {
    last: Option<(isize, isize)>,
}

impl Layouts {
    /// Takes the foreground window, its layout and how many layouts there
    /// are, and says whether to show the layout: only when the same window
    /// got another one. Moving to a window with its own layout shows
    /// nothing, as in Windows.
    pub fn update(&mut self, window: isize, layout: isize, count: usize) -> bool {
        let switched = count > 1 && self.last.is_some_and(|(w, l)| w == window && l != layout);
        self.last = Some((window, layout));
        switched
    }
}

/// The display brightness as last read, in percent.
#[derive(Debug, Default)]
pub struct Brightness {
    last: Option<u8>,
}

impl Brightness {
    /// Learns the brightness without showing it.
    pub fn set(&mut self, level: u8) {
        self.last = Some(level.min(100));
    }

    /// Takes a new brightness and gives it to show when it moved by a key's
    /// step or more.
    pub fn update(&mut self, level: u8) -> Option<Osd> {
        let level = level.min(100);
        let moved = self
            .last
            .is_none_or(|last| last.abs_diff(level) >= BRIGHTNESS_STEP);
        self.last = Some(level);
        moved.then(|| Osd::Brightness(f64::from(level) / 100.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::osd::show_args;
    use serde_json::json;

    #[test]
    fn sends_kind_level_and_name() {
        assert_eq!(
            show_args(&Osd::Volume(0.3)),
            [json!("volume"), json!(0.3), json!("")]
        );
        assert_eq!(
            show_args(&Osd::Muted),
            [json!("muted"), json!(0.0), json!("")]
        );
        assert_eq!(
            show_args(&Osd::CapsLock(true)),
            [json!("caps-lock"), json!(1.0), json!("")]
        );
        assert_eq!(
            show_args(&Osd::NumLock(false)),
            [json!("num-lock"), json!(0.0), json!("")]
        );
        assert_eq!(
            show_args(&Osd::Layout("English (United States)".into())),
            [
                json!("layout"),
                json!(-1.0),
                json!("English (United States)")
            ]
        );
    }

    #[test]
    fn rounds_the_volume_and_says_muted() {
        assert_eq!(volume(0.3, false), Osd::Volume(0.3));
        assert_eq!(volume(0.666_666, false), Osd::Volume(0.67));
        assert_eq!(volume(1.2, false), Osd::Volume(1.0));
        assert_eq!(volume(0.5, true), Osd::Muted);
    }

    #[test]
    fn counts_a_volume_change_only_just_after_a_key() {
        assert!(after_volume_key(10_000, 10_000));
        assert!(after_volume_key(10_000, 10_000 + KEY_WINDOW_MS));
        assert!(!after_volume_key(10_000, 10_001 + KEY_WINDOW_MS));
        assert!(!after_volume_key(0, 500));
        // A clock read before the key's does not wrap round.
        assert!(after_volume_key(10_000, 9_990));
    }

    #[test]
    fn shows_a_lock_key_only_when_it_changes() {
        let mut locks = Locks::default();
        assert_eq!(locks.update(true, true), []);
        assert_eq!(locks.update(true, true), []);
        assert_eq!(locks.update(false, true), [Osd::CapsLock(false)]);
        assert_eq!(
            locks.update(true, false),
            [Osd::CapsLock(true), Osd::NumLock(false)]
        );
    }

    #[test]
    fn shows_the_layout_when_the_same_window_switches() {
        let (english, indonesian) = (0x0409_0409, 0x0421_0421);
        let mut layouts = Layouts::default();
        assert!(!layouts.update(1, english, 2));
        assert!(layouts.update(1, indonesian, 2));
        assert!(!layouts.update(1, indonesian, 2));
        // Another window with its own layout is not a switch.
        assert!(!layouts.update(2, english, 2));
        assert!(layouts.update(2, indonesian, 2));
        // With one layout there is nothing to tell apart.
        assert!(!layouts.update(2, english, 1));
        assert_eq!(layout_language(0x0409_0421), 0x0421);
    }

    #[test]
    fn shows_brightness_steps_but_not_the_sensors_drift() {
        let mut brightness = Brightness::default();
        brightness.set(50);
        assert_eq!(brightness.update(60), Some(Osd::Brightness(0.6)));
        assert_eq!(brightness.update(62), None);
        assert_eq!(brightness.update(64), None);
        assert_eq!(brightness.update(54), Some(Osd::Brightness(0.54)));
        assert_eq!(brightness.update(200), Some(Osd::Brightness(1.0)));
    }

    #[test]
    fn shows_the_first_brightness_change_it_hears_of() {
        assert_eq!(Brightness::default().update(30), Some(Osd::Brightness(0.3)));
    }
}
