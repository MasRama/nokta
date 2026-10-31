//! Where a notch window sits on its monitor, and which part of it takes the
//! pointer. Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

/// Room around the notch for its glow, in logical px.
pub const GLOW_MARGIN: u32 = 32;
/// The tallest open view, as the extension's `PICTURE_HEIGHT`.
pub const TALLEST_VIEW: u32 = 420;

/// A monitor's area in physical px and its scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Monitor {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

/// A rectangle in physical px.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A rectangle in the page's CSS px, as the UI reports it.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The `[appearance]` sizes that decide how big the window must be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NotchSizes {
    pub height: u32,
    pub idle_width: u32,
    pub playing_width: u32,
    pub expanded_width: u32,
    pub osd_width: u32,
    pub expanded_height: u32,
    pub ear_radius: u32,
}

impl Default for NotchSizes {
    /// The default config's sizes.
    fn default() -> Self {
        Self {
            height: 32,
            idle_width: 180,
            playing_width: 260,
            expanded_width: 420,
            osd_width: 300,
            expanded_height: 150,
            ear_radius: 8,
        }
    }
}

impl From<&nokta_core::features::settings::Appearance> for NotchSizes {
    fn from(a: &nokta_core::features::settings::Appearance) -> Self {
        Self {
            height: a.height,
            idle_width: a.idle_width,
            playing_width: a.playing_width,
            expanded_width: a.expanded_width,
            osd_width: a.osd_width,
            expanded_height: a.expanded_height,
            ear_radius: a.ear_radius,
        }
    }
}

/// The window's size in logical px: the widest notch with its ears and the
/// tallest view, with room for the glow.
pub fn window_logical_size(sizes: &NotchSizes) -> (f64, f64) {
    let widest = [
        sizes.idle_width,
        sizes.playing_width,
        sizes.expanded_width,
        sizes.osd_width,
    ]
    .into_iter()
    .max()
    .unwrap_or(sizes.expanded_width);
    let width = widest + 2 * sizes.ear_radius + 2 * GLOW_MARGIN;
    let height = sizes.expanded_height.max(TALLEST_VIEW) + GLOW_MARGIN;
    (f64::from(width), f64::from(height))
}

/// The window on `monitor`: `logical` scaled, at the top centre, never
/// larger than the monitor.
pub fn window_rect(monitor: &Monitor, logical: (f64, f64)) -> Rect {
    let width = scaled(logical.0, monitor.scale).min(monitor.width);
    let height = scaled(logical.1, monitor.scale).min(monitor.height);
    // Both fit in the monitor, so the halved difference fits in an i32.
    let x = monitor.x + ((monitor.width - width) / 2) as i32;
    Rect {
        x,
        y: monitor.y,
        width,
        height,
    }
}

fn scaled(logical: f64, scale: f64) -> u32 {
    (logical * scale).round().max(0.0) as u32
}

/// The part of `window` that takes the pointer: `css` scaled, rounded
/// outward and kept inside the window, relative to the window.
pub fn region_rect(window: &Rect, scale: f64, css: CssRect) -> Rect {
    let clamp = |value: f64, max: u32| value.clamp(0.0, f64::from(max));
    let left = clamp((css.x * scale).floor(), window.width);
    let top = clamp((css.y * scale).floor(), window.height);
    let right = clamp(((css.x + css.width) * scale).ceil(), window.width).max(left);
    let bottom = clamp(((css.y + css.height) * scale).ceil(), window.height).max(top);
    Rect {
        x: left as i32,
        y: top as i32,
        width: (right - left) as u32,
        height: (bottom - top) as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, width: u32, height: u32, scale: f64) -> Monitor {
        Monitor {
            x,
            y: 0,
            width,
            height,
            scale,
        }
    }

    #[test]
    fn the_window_fits_the_widest_notch_and_the_tallest_view() {
        let sizes = NotchSizes::default();
        assert_eq!(
            window_logical_size(&sizes),
            (420.0 + 16.0 + 64.0, 420.0 + 32.0)
        );
        let tall = NotchSizes {
            expanded_height: 600,
            osd_width: 700,
            ..sizes
        };
        assert_eq!(
            window_logical_size(&tall),
            (700.0 + 16.0 + 64.0, 600.0 + 32.0)
        );
    }

    #[test]
    fn the_default_sizes_are_the_default_configs() {
        let config = nokta_core::features::settings::Config::default();
        assert_eq!(NotchSizes::from(&config.appearance), NotchSizes::default());
    }

    #[test]
    fn the_window_sits_at_the_top_centre_scaled() {
        let rect = window_rect(&monitor(0, 1920, 1080, 1.25), (500.0, 452.0));
        assert_eq!(
            rect,
            Rect {
                x: (1920 - 625) / 2,
                y: 0,
                width: 625,
                height: 565
            }
        );
    }

    #[test]
    fn a_second_monitor_keeps_its_window() {
        let rect = window_rect(&monitor(1920, 2560, 1440, 1.0), (500.0, 452.0));
        assert_eq!(rect.x, 1920 + (2560 - 500) / 2);
        assert_eq!(rect.y, 0);
    }

    #[test]
    fn a_window_wider_than_its_monitor_is_cut_to_it() {
        let rect = window_rect(&monitor(-1280, 1280, 300, 1.0), (2064.0, 452.0));
        assert_eq!(
            rect,
            Rect {
                x: -1280,
                y: 0,
                width: 1280,
                height: 300
            }
        );
    }

    #[test]
    fn the_region_is_scaled_and_rounded_outward() {
        let window = Rect {
            x: 0,
            y: 0,
            width: 750,
            height: 678,
        };
        let css = CssRect {
            x: 10.3,
            y: 0.0,
            width: 100.4,
            height: 32.0,
        };
        let region = region_rect(&window, 1.5, css);
        // 10.3 * 1.5 = 15.45 down to 15; (10.3 + 100.4) * 1.5 = 166.05 up to 167.
        assert_eq!(
            region,
            Rect {
                x: 15,
                y: 0,
                width: 152,
                height: 48
            }
        );
    }

    #[test]
    fn the_region_stays_inside_the_window() {
        let window = Rect {
            x: 0,
            y: 0,
            width: 500,
            height: 452,
        };
        let css = CssRect {
            x: -20.0,
            y: -5.0,
            width: 600.0,
            height: 900.0,
        };
        assert_eq!(
            region_rect(&window, 1.0, css),
            Rect {
                x: 0,
                y: 0,
                width: 500,
                height: 452
            }
        );
        let gone = CssRect {
            x: 600.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        };
        assert_eq!(region_rect(&window, 1.0, gone).width, 0);
    }
}
