//! The open shortcut: a hotkey registered with Windows that opens a notch
//! with the keyboard, or closes the one that has it. The notch opens on the
//! monitor of the window in use, takes the focus, and gives it back to that
//! window when it closes.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use nokta_core::features::settings::Config;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_NOREPEAT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetMessageW, IsWindow, PostThreadMessageW, SetForegroundWindow, MSG,
    WM_APP, WM_HOTKEY,
};

use super::monitors;
use crate::shortcut;

/// Tells a page to open with the keyboard, or to close if it has it.
pub const KEYBOARD_EVENT: &str = "nokta://keyboard";
/// The one hotkey's id.
const HOTKEY_ID: i32 = 1;
/// Asks the thread to register the shortcut again.
const WM_RESET: u32 = WM_APP + 1;

/// The thread that owns the hotkey; 0 until it runs.
static THREAD: AtomicU32 = AtomicU32::new(0);
/// The shortcut the config asks for.
static WANTED: Mutex<String> = Mutex::new(String::new());
/// The notch that has the keyboard, and the window it took it from.
static HOLDER: Mutex<Option<(String, isize)>> = Mutex::new(None);

/// Registers the config's shortcut, and again whenever it changes.
pub fn follow(mut config: watch::Receiver<Config>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let wanted = config.borrow_and_update().behavior.open_shortcut.clone();
            set(wanted);
            if config.changed().await.is_err() {
                return;
            }
        }
    });
}

fn set(accelerator: String) {
    {
        let mut wanted = WANTED.lock().unwrap_or_else(|e| e.into_inner());
        if *wanted == accelerator {
            return;
        }
        *wanted = accelerator;
    }
    let thread = THREAD.load(Ordering::Acquire);
    if thread != 0 {
        // SAFETY: a message with no pointers in it to a thread of ours.
        let _ = unsafe { PostThreadMessageW(thread, WM_RESET, WPARAM(0), LPARAM(0)) };
    }
}

/// Starts the hotkey's thread, once.
pub fn start(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("nokta-shortcut".into())
        .spawn(move || {
            // SAFETY: the id of the calling thread.
            THREAD.store(unsafe { GetCurrentThreadId() }, Ordering::Release);
            register();
            let mut msg = MSG::default();
            // SAFETY: `msg` is a valid place for the next message; -1 is an
            // error.
            while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {
                match msg.message {
                    WM_HOTKEY => toggle(&app),
                    WM_RESET => register(),
                    _ => {}
                }
            }
        });
    if let Err(err) = spawned {
        tracing::error!("cannot follow the open shortcut: {err}");
    }
}

/// Registers the wanted shortcut in place of the last one.
fn register() {
    let wanted = WANTED.lock().unwrap_or_else(|e| e.into_inner()).clone();
    // SAFETY: the hotkey is this thread's; none registered only fails.
    let _ = unsafe { UnregisterHotKey(None, HOTKEY_ID) };
    if wanted.is_empty() {
        return;
    }
    let Some(hotkey) = shortcut::parse(&wanted) else {
        tracing::warn!("Windows has no key for the open shortcut {wanted:?}");
        return;
    };
    let modifiers = HOT_KEY_MODIFIERS(hotkey.modifiers) | MOD_NOREPEAT;
    // SAFETY: a thread hotkey: WM_HOTKEY comes to this thread's loop.
    if let Err(err) = unsafe { RegisterHotKey(None, HOTKEY_ID, modifiers, hotkey.key) } {
        tracing::warn!("cannot register the open shortcut {wanted:?}: {err}");
    }
}

/// The notch with the keyboard closes; else the one on the monitor in use
/// opens and takes it.
fn toggle(app: &AppHandle) {
    let holder = HOLDER.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some((label, _)) = holder {
        tell(app, &label);
        return;
    }
    // SAFETY: reads which window is in front.
    let previous = unsafe { GetForegroundWindow() };
    let Some(window) = monitors::notch_on_monitor_of(app, previous) else {
        return;
    };
    let label = window.label().to_owned();
    *HOLDER.lock().unwrap_or_else(|e| e.into_inner()) = Some((label.clone(), previous.0 as isize));
    if let Err(err) = window.set_focus() {
        tracing::warn!("cannot give {label} the keyboard: {err}");
    }
    tell(app, &label);
}

fn tell(app: &AppHandle, label: &str) {
    if let Err(err) = app.emit_to(label, KEYBOARD_EVENT, ()) {
        tracing::warn!("cannot tell {label} about the shortcut: {err}");
    }
}

/// The notch `label` closed: the window it took the keyboard from gets it
/// back.
pub fn release(label: &str) {
    let previous = {
        let mut holder = HOLDER.lock().unwrap_or_else(|e| e.into_inner());
        match holder.take() {
            Some((held, previous)) if held == label => previous,
            other => {
                *holder = other;
                return;
            }
        }
    };
    let previous = HWND(previous as *mut _);
    // SAFETY: the window may have closed meanwhile; IsWindow says so.
    unsafe {
        if IsWindow(Some(previous)).as_bool() {
            let _ = SetForegroundWindow(previous);
        }
    }
}

/// The window `label` closed: it no longer has the keyboard.
pub fn forget(label: &str) {
    let mut holder = HOLDER.lock().unwrap_or_else(|e| e.into_inner());
    if holder.as_ref().is_some_and(|(held, _)| held == label) {
        *holder = None;
    }
}
