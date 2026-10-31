//! The shortcuts, hotkeys registered with Windows. The open shortcut opens
//! a notch with the keyboard, or closes the one that has it: the notch opens
//! on the monitor of the window in use, takes the focus, and gives it back
//! to that window when it closes. The focus shortcut starts a focus session
//! or stops the timer, as GNOME's does.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};

use nokta_core::features::settings::Config;
use nokta_core::features::timer::logic::Snapshot;
use nokta_core::features::timer::service::Command;
use tauri::{AppHandle, Emitter, WebviewWindow};
use tokio::sync::{mpsc, watch};
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
use crate::bridge::timer::focus_shortcut;
use crate::shortcut;

/// Tells a page to open with the keyboard, or to close if it has it.
pub const KEYBOARD_EVENT: &str = "nokta://keyboard";
/// The open shortcut's hotkey id.
const OPEN_ID: i32 = 1;
/// The focus shortcut's hotkey id.
const FOCUS_ID: i32 = 2;
/// Asks the thread to register the shortcut again.
const WM_RESET: u32 = WM_APP + 1;

/// The thread that owns the hotkey; 0 until it runs.
static THREAD: AtomicU32 = AtomicU32::new(0);
/// The open and the focus shortcut the config asks for.
static WANTED: Mutex<[String; 2]> = Mutex::new([String::new(), String::new()]);
/// The focus timer, which the focus shortcut starts or stops.
static TIMER: OnceLock<(watch::Receiver<Snapshot>, mpsc::Sender<Command>)> = OnceLock::new();
/// The notch that has the keyboard, and the window it took it from.
static HOLDER: Mutex<Option<(String, isize)>> = Mutex::new(None);

/// Registers the config's shortcuts, and again whenever they change; the
/// focus shortcut works `timer`.
pub fn follow(
    mut config: watch::Receiver<Config>,
    timer: (watch::Receiver<Snapshot>, mpsc::Sender<Command>),
) {
    let _ = TIMER.set(timer);
    tauri::async_runtime::spawn(async move {
        loop {
            let wanted = {
                let config = config.borrow_and_update();
                [
                    config.behavior.open_shortcut.clone(),
                    config.timer.shortcut.clone(),
                ]
            };
            set(wanted);
            if config.changed().await.is_err() {
                return;
            }
        }
    });
}

fn set(accelerators: [String; 2]) {
    {
        let mut wanted = WANTED.lock().unwrap_or_else(|e| e.into_inner());
        if *wanted == accelerators {
            return;
        }
        *wanted = accelerators;
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
                    WM_HOTKEY if msg.wParam.0 == FOCUS_ID as usize => focus(),
                    WM_HOTKEY => toggle(&app),
                    WM_RESET => register(),
                    _ => {}
                }
            }
        });
    if let Err(err) = spawned {
        tracing::error!("cannot follow the shortcuts: {err}");
    }
}

/// Registers the wanted shortcuts in place of the last ones.
fn register() {
    let [open, focus] = WANTED.lock().unwrap_or_else(|e| e.into_inner()).clone();
    register_one(OPEN_ID, "open", &open);
    register_one(FOCUS_ID, "focus", &focus);
}

fn register_one(id: i32, name: &str, wanted: &str) {
    // SAFETY: the hotkey is this thread's; none registered only fails.
    let _ = unsafe { UnregisterHotKey(None, id) };
    if wanted.is_empty() {
        return;
    }
    let Some(hotkey) = shortcut::parse(wanted) else {
        tracing::warn!("Windows has no key for the {name} shortcut {wanted:?}");
        return;
    };
    let modifiers = HOT_KEY_MODIFIERS(hotkey.modifiers) | MOD_NOREPEAT;
    // SAFETY: a thread hotkey: WM_HOTKEY comes to this thread's loop.
    if let Err(err) = unsafe { RegisterHotKey(None, id, modifiers, hotkey.key) } {
        tracing::warn!("cannot register the {name} shortcut {wanted:?}: {err}");
    }
}

/// Starts focus when the timer is idle, else stops it.
fn focus() {
    let Some((state, commands)) = TIMER.get() else {
        return;
    };
    let command = focus_shortcut(state.borrow().state);
    if commands.try_send(command).is_err() {
        tracing::warn!("the timer did not take the focus shortcut");
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
    hold(&window, previous);
    tell(app, window.label());
}

/// The notch `window` takes the keyboard for a field to type in, as the
/// open shortcut gives it, unless it has it already.
pub fn take(window: &WebviewWindow) {
    let holds = HOLDER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|(held, _)| held == window.label());
    if holds {
        return;
    }
    // SAFETY: reads which window is in front.
    hold(window, unsafe { GetForegroundWindow() });
}

/// Gives `window` the keyboard; `previous` gets it back on release.
fn hold(window: &WebviewWindow, previous: HWND) {
    let label = window.label().to_owned();
    *HOLDER.lock().unwrap_or_else(|e| e.into_inner()) = Some((label.clone(), previous.0 as isize));
    if let Err(err) = window.set_focus() {
        tracing::warn!("cannot give {label} the keyboard: {err}");
    }
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
