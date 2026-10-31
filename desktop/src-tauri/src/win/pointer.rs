//! Clicks pass through a notch window except over the notch. A thread
//! follows the pointer and, as it crosses a notch's edge, makes that window
//! take clicks or let them through, and tells its page. The whole window
//! stays free to draw in, so the glow and the shadow reach past the notch.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

use super::notch_window;
use crate::layout::Rect;

/// Tells a page whether the pointer is over its notch.
pub const POINTER_EVENT: &str = "nokta://pointer";
/// About once a frame at 60 Hz.
const POLL: Duration = Duration::from_millis(16);

struct Hit {
    label: String,
    hwnd: isize,
    /// In screen px; empty until the page reports it.
    rect: Rect,
    inside: bool,
}

static HITS: Mutex<Vec<Hit>> = Mutex::new(Vec::new());

/// Sets the part of the window `label` that takes clicks, in screen px.
pub fn set(label: &str, hwnd: HWND, rect: Rect) {
    let mut hits = HITS.lock().unwrap_or_else(|e| e.into_inner());
    match hits.iter_mut().find(|hit| hit.label == label) {
        Some(hit) => {
            hit.hwnd = hwnd.0 as isize;
            hit.rect = rect;
        }
        None => hits.push(Hit {
            label: label.to_owned(),
            hwnd: hwnd.0 as isize,
            rect,
            inside: false,
        }),
    }
}

/// Starts following the pointer, once.
pub fn start(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("nokta-pointer".into())
        .spawn(move || loop {
            std::thread::sleep(POLL);
            let mut point = POINT::default();
            // SAFETY: writes the cursor position into `point`.
            if unsafe { GetCursorPos(&mut point) }.is_err() {
                continue;
            }
            for (label, hwnd, inside) in crossed(point) {
                notch_window::set_click_through(HWND(hwnd as *mut _), !inside);
                if let Err(err) = app.emit_to(label.as_str(), POINTER_EVENT, inside) {
                    tracing::warn!("cannot tell {label} about the pointer: {err}");
                }
            }
        });
    if let Err(err) = spawned {
        tracing::error!("cannot follow the pointer: {err}");
    }
}

/// The windows whose notch the pointer at `point` just entered or left.
fn crossed(point: POINT) -> Vec<(String, isize, bool)> {
    let mut hits = HITS.lock().unwrap_or_else(|e| e.into_inner());
    let mut changes = Vec::new();
    for hit in hits.iter_mut() {
        let inside = hit.rect.contains(point.x, point.y);
        if inside != hit.inside {
            hit.inside = inside;
            changes.push((hit.label.clone(), hit.hwnd, inside));
        }
    }
    changes
}
