//! One notch window per monitor, as the monitors come, go and change. A
//! notch window hears Windows say the displays changed (a monitor plugged
//! in or out, a new resolution or arrangement) or that its scale changed;
//! once that settles, the windows are planned anew (`monitors.rs`) and
//! placed. Alerts go to the notch on the monitor in use.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

use super::{fullscreen, notch_window, pointer, shortcut, topmost};
use crate::layout::{Monitor, Rect};
use crate::monitors::{plan, PREFIX};

/// How long the displays settle before the windows follow.
const SETTLE: Duration = Duration::from_millis(500);

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The windows' size in logical px, as the notch's settings ask.
static LOGICAL: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));
/// Each notch window and the monitor it was placed on.
static PLACED: Mutex<Vec<(String, Rect)>> = Mutex::new(Vec::new());
/// Counts the changes, so only the last of a burst rebuilds.
static CHANGES: AtomicU64 = AtomicU64::new(0);

/// Opens a notch window `logical` big on every monitor. Call on the main
/// thread, once.
pub fn start(app: &AppHandle, logical: (f64, f64)) {
    let _ = APP.set(app.clone());
    *LOGICAL.lock().unwrap_or_else(|e| e.into_inner()) = logical;
    rebuild(app);
}

/// The windows take a new size, at once: the notch may already be bigger.
pub fn resize(logical: (f64, f64)) {
    *LOGICAL.lock().unwrap_or_else(|e| e.into_inner()) = logical;
    if let Some(app) = APP.get().cloned() {
        rebuild_on_main(app);
    }
}

/// The displays changed: the windows follow once they settle.
pub fn changed() {
    let Some(app) = APP.get().cloned() else {
        return;
    };
    let change = CHANGES.fetch_add(1, Ordering::AcqRel) + 1;
    let spawned = std::thread::Builder::new()
        .name("nokta-monitors".into())
        .spawn(move || {
            std::thread::sleep(SETTLE);
            if CHANGES.load(Ordering::Acquire) != change {
                return;
            }
            rebuild_on_main(app);
        });
    if let Err(err) = spawned {
        tracing::warn!("cannot follow the monitors: {err}");
    }
}

fn rebuild_on_main(app: AppHandle) {
    let on_main = app.clone();
    if let Err(err) = app.run_on_main_thread(move || rebuild(&on_main)) {
        tracing::warn!("cannot follow the monitors: {err}");
    }
}

/// Closes, places and opens notch windows for the monitors now.
fn rebuild(app: &AppHandle) {
    let monitors: Vec<Monitor> = match app.available_monitors() {
        Ok(found) => found.iter().map(monitor_of).collect(),
        Err(err) => {
            tracing::warn!("cannot list the monitors: {err}");
            return;
        }
    };
    // Windows says no monitor for a moment while they change; wait for one.
    if monitors.is_empty() {
        return;
    }
    let rects: Vec<Rect> = monitors.iter().map(rect_of).collect();
    let logical = *LOGICAL.lock().unwrap_or_else(|e| e.into_inner());
    let mut placed = PLACED.lock().unwrap_or_else(|e| e.into_inner());
    let plan = plan(&placed, &rects);
    for label in &plan.close {
        if let Some(window) = app.get_webview_window(label) {
            if let Err(err) = window.destroy() {
                tracing::warn!("cannot close {label}: {err}");
            }
        }
        pointer::forget(label);
        fullscreen::forget(label);
        shortcut::forget(label);
    }
    let mut now = Vec::new();
    for (label, index) in &plan.keep {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        if let Err(err) = notch_window::place(&window, &monitors[*index], logical) {
            tracing::warn!("cannot place {label}: {err}");
        }
        now.push((label.clone(), rects[*index]));
    }
    for (label, index) in &plan.create {
        match notch_window::create(app, label, &monitors[*index], logical) {
            Ok(_) => now.push((label.clone(), rects[*index])),
            Err(err) => tracing::error!("cannot open {label}: {err}"),
        }
    }
    *placed = now;
    drop(placed);
    let notches: Vec<HWND> = notches(app)
        .iter()
        .filter_map(|window| window.hwnd().ok())
        .collect();
    topmost::install(&notches);
    // A window that moved takes clicks where its notch is now.
    super::refresh_hits(app);
}

fn monitor_of(found: &tauri::Monitor) -> Monitor {
    Monitor {
        x: found.position().x,
        y: found.position().y,
        width: found.size().width,
        height: found.size().height,
        scale: found.scale_factor(),
    }
}

fn rect_of(monitor: &Monitor) -> Rect {
    Rect {
        x: monitor.x,
        y: monitor.y,
        width: monitor.width,
        height: monitor.height,
    }
}

/// The notch windows, in the order of their labels.
pub fn notches(app: &AppHandle) -> Vec<WebviewWindow> {
    let mut notches: Vec<WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(PREFIX))
        .map(|(_, window)| window)
        .collect();
    notches.sort_by(|a, b| a.label().cmp(b.label()));
    notches
}

/// The notch window on the monitor of `front`, else the first.
pub fn notch_on_monitor_of(app: &AppHandle, front: HWND) -> Option<WebviewWindow> {
    // SAFETY: a null or stale window falls back to the primary monitor.
    let monitor = unsafe { MonitorFromWindow(front, MONITOR_DEFAULTTOPRIMARY) };
    let mut notches = notches(app);
    let on_monitor = notches.iter().position(|window| {
        window.hwnd().is_ok_and(|hwnd| {
            // SAFETY: the notch window is ours and alive.
            let own = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY) };
            own == monitor
        })
    });
    match on_monitor {
        Some(index) => Some(notches.swap_remove(index)),
        None => notches.into_iter().next(),
    }
}

/// The label of the notch on the monitor of the window in front, for an
/// alert: the extension shows one on the focused monitor too.
pub fn notch_in_front(app: &AppHandle) -> Option<String> {
    // SAFETY: reads which window is in front.
    let front = unsafe { GetForegroundWindow() };
    notch_on_monitor_of(app, front).map(|window| window.label().to_owned())
}
