//! A notch window: borderless, see-through, above other windows, never in
//! Alt+Tab or the taskbar, never taking the focus from a click, and taking
//! the pointer only inside the region the page reports.

use tauri::{
    AppHandle, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST,
    MA_NOACTIVATE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
    WM_MOUSEACTIVATE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::layout::{self, Monitor, Rect};

/// Our subclass's id on the window ("NOKT"), apart from tao's own.
const SUBCLASS_ID: usize = 0x4E4F_4B54;

/// Opens the notch window for `monitor`, shown without taking the focus.
/// Nothing takes the pointer until the page reports its region.
pub fn create(
    app: &AppHandle,
    index: usize,
    monitor: &Monitor,
    logical: (f64, f64),
) -> tauri::Result<WebviewWindow> {
    let rect = layout::window_rect(monitor, logical);
    let window = WebviewWindowBuilder::new(
        app,
        format!("notch-{index}"),
        WebviewUrl::App("index.html".into()),
    )
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
    // Moving first lets Windows apply the monitor's scale before the size.
    window.set_position(PhysicalPosition::new(rect.x, rect.y))?;
    window.set_size(PhysicalSize::new(rect.width, rect.height))?;
    let hwnd = window.hwnd()?;
    make_overlay(hwnd);
    set_region(
        hwnd,
        &Rect {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        },
    );
    // SAFETY: `hwnd` is the window just built, alive on this thread.
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    Ok(window)
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

/// A click on the notch must not take the focus from the app the user is in.
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
    // SAFETY: passes the message on to the next handler of this window.
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

/// Clips the window to `rect` (window px): only there does it take the
/// pointer, and only there does it draw.
pub fn set_region(hwnd: HWND, rect: &Rect) {
    let right = rect.x + rect.width as i32;
    let bottom = rect.y + rect.height as i32;
    // SAFETY: the window takes ownership of the region it is given.
    unsafe {
        let region = CreateRectRgn(rect.x, rect.y, right, bottom);
        SetWindowRgn(hwnd, Some(region), true);
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
    fn an_overlay_stays_out_of_alt_tab_and_never_activates() {
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
            DestroyWindow(hwnd).expect("destroyed");
        }
    }
}
