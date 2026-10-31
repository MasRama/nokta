//! Keeps the notches above other always-on-top windows: each time another
//! window comes to the foreground, the notches are raised again.

use std::sync::Mutex;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, EVENT_SYSTEM_FOREGROUND, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    WINEVENT_OUTOFCONTEXT,
};

/// The notch windows, as raw handles (an `HWND` is not `Send`).
static NOTCHES: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// Follows the foreground window from now on. Call on the thread that runs
/// the message loop (Tauri's main thread); the hook lives as long as the app.
pub fn install(notches: &[HWND]) {
    let first = {
        let mut known = NOTCHES.lock().unwrap_or_else(|e| e.into_inner());
        let first = known.is_empty();
        *known = notches.iter().map(|hwnd| hwnd.0 as isize).collect();
        first
    };
    if !first {
        return;
    }
    // SAFETY: an out-of-context hook with a plain callback and no module.
    unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
    }
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _hwnd: HWND,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    let known = NOTCHES.lock().unwrap_or_else(|e| e.into_inner());
    for &raw in known.iter() {
        // SAFETY: a notch window; a stale handle only makes the call fail.
        unsafe {
            let _ = SetWindowPos(
                HWND(raw as *mut _),
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}
