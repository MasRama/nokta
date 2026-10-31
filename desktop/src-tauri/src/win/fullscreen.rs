//! Tells each notch window when a fullscreen app covers its monitor, so it
//! hides. A thread follows Windows' window events (a new foreground window,
//! a window moved, resized or minimized) and, a moment after a burst of
//! them, looks at the app windows in their stacking order.

use std::cell::Cell;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetMessageW, GetShellWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, KillTimer, SetTimer,
    CHILDID_SELF, EVENT_OBJECT_LOCATIONCHANGE, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND,
    EVENT_SYSTEM_MINIMIZESTART, GWL_EXSTYLE, GWL_STYLE, MSG, OBJID_WINDOW, WINDOW_EX_STYLE,
    WINDOW_STYLE, WINEVENT_OUTOFCONTEXT, WM_TIMER, WS_CAPTION, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
};

use crate::fullscreen::{covered, Stacked};
use crate::layout::Rect;

/// Tells a page whether a fullscreen app covers its monitor.
pub const FULLSCREEN_EVENT: &str = "nokta://fullscreen";
/// How long the windows settle after an event before they are looked at.
const SETTLE_MS: u32 = 100;
/// The desktop and the taskbar: they cover a monitor, or sit on it, but are
/// no app.
const SHELL_CLASSES: [&str; 4] = [
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
];

/// Each notch window's label and whether its monitor is covered.
static COVERED: Mutex<Vec<(String, bool)>> = Mutex::new(Vec::new());

thread_local! {
    /// The settle timer's id; 0 while it is off.
    static TIMER: Cell<usize> = const { Cell::new(0) };
}

/// Whether a fullscreen app covers the monitor of the window `label`.
pub fn is_covered(label: &str) -> bool {
    let covered = COVERED.lock().unwrap_or_else(|e| e.into_inner());
    covered.iter().any(|(l, on)| l == label && *on)
}

/// Starts following the windows, once.
pub fn start(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("nokta-fullscreen".into())
        .spawn(move || {
            let events = [
                (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
                (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
                (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
            ];
            for (first, last) in events {
                // SAFETY: an out-of-context hook with a plain callback and
                // no module; Windows calls it from this thread's loop.
                unsafe {
                    SetWinEventHook(
                        first,
                        last,
                        None,
                        Some(on_event),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    );
                }
            }
            check(&app);
            let mut msg = MSG::default();
            // SAFETY: `msg` is a valid place for the next message; -1 is an
            // error.
            while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {
                if msg.message == WM_TIMER {
                    // SAFETY: the timer is this thread's.
                    let _ = unsafe { KillTimer(None, TIMER.replace(0)) };
                    check(&app);
                }
            }
        });
    if let Err(err) = spawned {
        tracing::error!("cannot follow fullscreen apps: {err}");
    }
}

/// A window event: looks at the windows once they settle.
unsafe extern "system" fn on_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    _hwnd: HWND,
    object: i32,
    child: i32,
    _thread: u32,
    _time: u32,
) {
    // Text carets and scroll bars move too; only windows count.
    if event == EVENT_OBJECT_LOCATIONCHANGE
        && (object != OBJID_WINDOW.0 || child != CHILDID_SELF as i32)
    {
        return;
    }
    if TIMER.get() == 0 {
        // SAFETY: a thread timer: its message comes to this thread's loop.
        TIMER.set(unsafe { SetTimer(None, 0, SETTLE_MS, None) });
    }
}

/// Tells every notch window whose monitor's state changed.
fn check(app: &AppHandle) {
    let stack = stack();
    for (label, window) in app.webview_windows() {
        if !label.starts_with("notch-") {
            continue;
        }
        let Some(monitor) = window.hwnd().ok().and_then(monitor_of) else {
            continue;
        };
        let now = covered(&stack, &monitor);
        let changed = {
            let mut known = COVERED.lock().unwrap_or_else(|e| e.into_inner());
            match known.iter_mut().find(|(l, _)| *l == label) {
                Some((_, was)) if *was == now => false,
                Some((_, was)) => {
                    *was = now;
                    true
                }
                None => {
                    known.push((label.clone(), now));
                    now
                }
            }
        };
        if changed {
            if let Err(err) = app.emit_to(label.as_str(), FULLSCREEN_EVENT, now) {
                tracing::warn!("cannot tell {label} about fullscreen: {err}");
            }
        }
    }
}

/// The app windows from the top of the stacking order down.
fn stack() -> Vec<Stacked> {
    let mut windows: Vec<Stacked> = Vec::new();
    // SAFETY: `windows` outlives the enumeration, which calls back on this
    // thread only.
    unsafe {
        let _ = EnumWindows(
            Some(add_window),
            LPARAM(std::ptr::from_mut(&mut windows) as isize),
        );
    }
    windows
}

unsafe extern "system" fn add_window(hwnd: HWND, windows: LPARAM) -> BOOL {
    // SAFETY: `stack` passes its list, alive for the enumeration.
    let windows = unsafe { &mut *(windows.0 as *mut Vec<Stacked>) };
    if let Some(window) = app_window(hwnd) {
        windows.push(window);
    }
    BOOL::from(true)
}

/// The window as the check sees it; none for what is no app window on
/// screen: hidden, minimized, cloaked (a suspended app), a tool window,
/// the shell, or Nokta's own.
fn app_window(hwnd: HWND) -> Option<Stacked> {
    // SAFETY: reads of a window's state; a stale handle only fails them.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return None;
        }
        let ex_style = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);
        if ex_style.contains(WS_EX_TOOLWINDOW) || hwnd == GetShellWindow() {
            return None;
        }
        let mut process = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process));
        if process == GetCurrentProcessId() || is_shell(hwnd) || is_cloaked(hwnd) {
            return None;
        }
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        let style = WINDOW_STYLE(GetWindowLongPtrW(hwnd, GWL_STYLE) as u32);
        Some(Stacked {
            rect: rect_of(rect),
            topmost: ex_style.contains(WS_EX_TOPMOST),
            framed: IsZoomed(hwnd).as_bool() && style.contains(WS_CAPTION),
        })
    }
}

fn is_shell(hwnd: HWND) -> bool {
    let mut class = [0u16; 64];
    // SAFETY: `class` holds as many characters as passed.
    let len = unsafe { GetClassNameW(hwnd, &mut class) };
    let class = String::from_utf16_lossy(&class[..usize::try_from(len).unwrap_or(0)]);
    SHELL_CLASSES.contains(&class.as_str())
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    // SAFETY: `cloaked` has room for the DWORD asked for.
    let read = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            std::ptr::from_mut(&mut cloaked).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    read.is_ok() && cloaked != 0
}

/// The whole of the monitor `hwnd` is on, in screen px.
fn monitor_of(hwnd: HWND) -> Option<Rect> {
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: `info` is sized as its `cbSize` says.
    let found = unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        GetMonitorInfoW(monitor, &mut info)
    };
    found.as_bool().then(|| rect_of(info.rcMonitor))
}

fn rect_of(rect: RECT) -> Rect {
    Rect {
        x: rect.left,
        y: rect.top,
        width: u32::try_from(rect.right - rect.left).unwrap_or(0),
        height: u32::try_from(rect.bottom - rect.top).unwrap_or(0),
    }
}
