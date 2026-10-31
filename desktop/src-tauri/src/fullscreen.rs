//! Whether a fullscreen app covers a monitor, from the windows in their
//! stacking order, as GNOME counts it: the top window on the monitor covers
//! all of it. Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::layout::Rect;

/// An app window as the check sees it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stacked {
    /// Its frame, in screen px.
    pub rect: Rect,
    /// Always on top, like a picture-in-picture player.
    pub topmost: bool,
    /// Maximized with a title bar: never fullscreen, even where it reaches
    /// past an auto-hidden taskbar.
    pub framed: bool,
}

/// Whether `monitor` shows a fullscreen window: the top window on it, past
/// smaller always-on-top ones, covers all of it. `stack` goes from the top.
pub fn covered(stack: &[Stacked], monitor: &Rect) -> bool {
    for window in stack.iter().filter(|w| centred_on(&w.rect, monitor)) {
        if !window.framed && covers(&window.rect, monitor) {
            return true;
        }
        if !window.topmost {
            return false;
        }
    }
    false
}

/// A window belongs to the monitor its centre is on.
fn centred_on(window: &Rect, monitor: &Rect) -> bool {
    let centre = |start: i32, length: u32| (i64::from(start) + i64::from(length) / 2) as i32;
    monitor.contains(
        centre(window.x, window.width),
        centre(window.y, window.height),
    )
}

fn covers(window: &Rect, monitor: &Rect) -> bool {
    let end = |start: i32, length: u32| i64::from(start) + i64::from(length);
    window.x <= monitor.x
        && window.y <= monitor.y
        && end(window.x, window.width) >= end(monitor.x, monitor.width)
        && end(window.y, window.height) >= end(monitor.y, monitor.height)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEFT: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    const RIGHT: Rect = Rect {
        x: 1920,
        y: 0,
        width: 2560,
        height: 1440,
    };

    fn window(x: i32, y: i32, width: u32, height: u32) -> Stacked {
        Stacked {
            rect: Rect {
                x,
                y,
                width,
                height,
            },
            topmost: false,
            framed: false,
        }
    }

    #[test]
    fn a_window_over_the_whole_monitor_is_fullscreen_there_only() {
        let stack = [window(1920, 0, 2560, 1440), window(100, 100, 800, 600)];
        assert!(covered(&stack, &RIGHT));
        assert!(!covered(&stack, &LEFT));
    }

    #[test]
    fn a_window_reaching_past_the_edges_still_covers() {
        assert!(covered(&[window(-8, -8, 1936, 1096)], &LEFT));
    }

    #[test]
    fn a_window_above_the_fullscreen_one_shows_the_notch_again() {
        let stack = [window(200, 200, 800, 600), window(0, 0, 1920, 1080)];
        assert!(!covered(&stack, &LEFT));
    }

    #[test]
    fn a_small_always_on_top_window_does_not_count() {
        let pip = Stacked {
            topmost: true,
            ..window(1500, 800, 400, 225)
        };
        assert!(covered(&[pip, window(0, 0, 1920, 1080)], &LEFT));
    }

    #[test]
    fn a_maximized_window_with_a_title_bar_is_not_fullscreen() {
        let maximized = Stacked {
            framed: true,
            ..window(-8, -8, 1936, 1096)
        };
        assert!(!covered(&[maximized], &LEFT));
    }

    #[test]
    fn no_window_is_no_fullscreen() {
        assert!(!covered(&[], &LEFT));
        assert!(!covered(&[window(0, 0, 1920, 1040)], &LEFT));
    }
}
