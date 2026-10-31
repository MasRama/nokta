//! A notch window: borderless, see-through, above other windows, never in
//! Alt+Tab or the taskbar, never taking the focus from a click, and letting
//! clicks through except over the notch (see `pointer`).

use tauri::{
    AppHandle, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST,
    MA_NOACTIVATE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
    WM_DISPLAYCHANGE, WM_DPICHANGED, WM_MOUSEACTIVATE, WS_EX_APPWINDOW, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

use crate::layout::{self, Monitor};

/// Our subclass's id on the window ("NOKT"), apart from tao's own.
const SUBCLASS_ID: usize = 0x4E4F_4B54;

/// Opens the notch window for `monitor`, shown without taking the focus.
/// Clicks go through it until the pointer comes over the notch.
pub fn create(
    app: &AppHandle,
    label: &str,
    monitor: &Monitor,
    logical: (f64, f64),
) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Nokta")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false)
        .build()?;
    place(&window, monitor, logical)?;
    let hwnd = window.hwnd()?;
    make_overlay(hwnd);
    set_click_through(hwnd, true);
    // SAFETY: `hwnd` is the window just built, alive on this thread.
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    Ok(window)
}

/// Moves and sizes `window` for `monitor`. Moving first lets Windows apply
/// the monitor's scale before the size.
pub fn place(window: &WebviewWindow, monitor: &Monitor, logical: (f64, f64)) -> tauri::Result<()> {
    let rect = layout::window_rect(monitor, logical);
    window.set_position(PhysicalPosition::new(rect.x, rect.y))?;
    window.set_size(PhysicalSize::new(rect.width, rect.height))
}

/// The extended styles and subclass that keep the window an overlay.
pub fn make_overlay(hwnd: HWND) {
    // SAFETY: plain Win32 calls on a live window owned by this thread.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let style = (style | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize)
            & !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
        let _ = SetWindowSubclass(hwnd, Some(no_activate), SUBCLASS_ID, 0);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

/// A click on the notch must not take the focus from the app the user is in;
/// and the windows follow the displays when they change.
unsafe extern "system" fn no_activate(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if message == WM_MOUSEACTIVATE {
        return LRESULT(MA_NOACTIVATE as isize);
    }
    if message == WM_DISPLAYCHANGE || message == WM_DPICHANGED {
        super::monitors::changed();
    }
    // SAFETY: passes the message on to the next handler of this window.
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

/// Lets clicks through the whole window, or takes them. Tao's own
/// `set_ignore_cursor_events` sets the same two bits but rewrites every
/// extended style, which would drop `WS_EX_TOOLWINDOW`.
pub fn set_click_through(hwnd: HWND, through: bool) {
    let bits = (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0) as isize;
    // SAFETY: plain Win32 calls on a live window of this process.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let style = if through { style | bits } else { style & !bits };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
    }
}

#[cfg(test)]
mod tests {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WS_POPUP,
    };

    use super::*;

    #[test]
    fn an_overlay_stays_out_of_alt_tab_never_activates_and_lets_clicks_through() {
        // SAFETY: a throwaway window of the built-in STATIC class.
        unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_APPWINDOW,
                w!("STATIC"),
                w!("nokta-test"),
                WS_POPUP,
                0,
                0,
                10,
                10,
                None,
                None,
                None,
                None,
            )
            .expect("a test window");
            make_overlay(hwnd);
            let style = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);
            assert!(style.contains(WS_EX_TOOLWINDOW));
            assert!(style.contains(WS_EX_NOACTIVATE));
            assert!(!style.contains(WS_EX_APPWINDOW));
            set_click_through(hwnd, true);
            let style = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);
            assert!(style.contains(WS_EX_TRANSPARENT | WS_EX_LAYERED));
            assert!(style.contains(WS_EX_TOOLWINDOW));
            set_click_through(hwnd, false);
            let style = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);
            assert!(!style.contains(WS_EX_TRANSPARENT));
            assert!(style.contains(WS_EX_NOACTIVATE));
            DestroyWindow(hwnd).expect("destroyed");
        }
    }
}
