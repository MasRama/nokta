//! Home's quick toggles on Windows. Dark style is the apps' light or dark
//! choice in Windows' personalisation, followed through its registry key;
//! set, it writes the system's choice too and tells running apps, as the
//! Settings app does. Caffeine keeps the screen and the system awake from a
//! thread of its own, since Windows ties that request to the thread.

use std::ffi::c_void;
use std::sync::{mpsc, Arc};

use tokio::sync::watch;
use windows::core::{w, Result, HSTRING, PCWSTR};
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
};
use windows::Win32::System::Registry::{
    RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER,
    KEY_NOTIFY, KEY_READ, REG_DWORD, REG_NOTIFY_CHANGE_LAST_SET, REG_SAM_FLAGS, RRF_RT_REG_DWORD,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};
use windows::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
};

use crate::bridge::toggles::TogglesState;

const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
/// How long one app may take to hear the new style.
const BROADCAST_MS: u32 = 200;

/// The toggles' states, and the way to set them.
pub struct Toggles {
    pub state: watch::Receiver<TogglesState>,
    caffeine: mpsc::Sender<bool>,
}

impl Toggles {
    /// Sets toggle `name` (`dark_style` or `caffeine`); false for a name
    /// Windows has no toggle for.
    pub fn set(&self, name: &str, on: bool) -> bool {
        match name {
            "dark_style" => {
                std::thread::spawn(move || {
                    if let Err(err) = set_dark_style(on) {
                        tracing::warn!("cannot set the dark style: {err}");
                    }
                });
                true
            }
            "caffeine" => self.caffeine.send(on).is_ok(),
            _ => false,
        }
    }
}

/// Starts following the dark style and holding caffeine.
pub fn spawn() -> Toggles {
    // Read at once, so the notch starts in the style Windows has.
    let path = HSTRING::from(PERSONALIZE);
    let initial = TogglesState {
        dark_style: apps_dark(HKEY_CURRENT_USER, PCWSTR(path.as_ptr())),
        caffeine: false,
    };
    let (tx, rx) = watch::channel(initial);
    let tx = Arc::new(tx);
    let style = tx.clone();
    let spawned = std::thread::Builder::new()
        .name("nokta-dark-style".into())
        .spawn(move || {
            if let Err(err) = follow_dark_style(&style) {
                tracing::warn!("cannot follow the dark style: {err}");
            }
        });
    if let Err(err) = spawned {
        tracing::warn!("cannot follow the dark style: {err}");
    }
    let (caffeine, wanted) = mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("nokta-caffeine".into())
        .spawn(move || hold_caffeine(&wanted, &tx));
    if let Err(err) = spawned {
        tracing::warn!("cannot keep the screen awake: {err}");
    }
    Toggles {
        state: rx,
        caffeine,
    }
}

/// Holds the screen and the system awake while caffeine is on. Windows
/// lets the request go when the thread ends: this one lives with the app.
fn hold_caffeine(wanted: &mpsc::Receiver<bool>, tx: &watch::Sender<TogglesState>) {
    while let Ok(on) = wanted.recv() {
        let flags = if on {
            ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        };
        // SAFETY: sets this thread's own request; 0 means it failed.
        let held = unsafe { SetThreadExecutionState(flags) }.0 != 0;
        if !held {
            tracing::warn!("Windows did not take the caffeine request");
            continue;
        }
        tx.send_if_modified(|state| {
            let changed = state.caffeine != on;
            state.caffeine = on;
            changed
        });
    }
}

fn follow_dark_style(tx: &watch::Sender<TogglesState>) -> Result<()> {
    let path = HSTRING::from(PERSONALIZE);
    let mut key = HKEY(std::ptr::null_mut());
    let access = REG_SAM_FLAGS(KEY_READ.0 | KEY_NOTIFY.0);
    // SAFETY: `path` is a NUL-ended string that outlives the call, and `key`
    // takes the handle, open as long as this thread runs.
    unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(path.as_ptr()),
            Some(0),
            access,
            &mut key,
        )
    }
    .ok()?;
    // SAFETY: makes a new, unnamed auto-reset event.
    let changed = unsafe { CreateEventW(None, false, false, PCWSTR::null()) }?;
    loop {
        // Asked before the read, so a change between the two is not lost.
        // SAFETY: the key and the event are open.
        unsafe {
            RegNotifyChangeKeyValue(key, false, REG_NOTIFY_CHANGE_LAST_SET, Some(changed), true)
        }
        .ok()?;
        let dark = apps_dark(key, PCWSTR::null());
        tx.send_if_modified(|state| {
            let changed = state.dark_style != dark;
            state.dark_style = dark;
            changed
        });
        // SAFETY: the event is open.
        unsafe { WaitForSingleObject(changed, INFINITE) };
    }
}

/// Whether the apps use the dark style, from `key` or its `subkey`; Windows'
/// default is light apps.
fn apps_dark(key: HKEY, subkey: PCWSTR) -> bool {
    dword(key, subkey, w!("AppsUseLightTheme")).is_some_and(|light| light == 0)
}

fn dword(key: HKEY, subkey: PCWSTR, value: PCWSTR) -> Option<u32> {
    let mut data = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: `subkey` is null or a NUL-ended string the caller holds, and
    // `data` has room for the `size` bytes asked for.
    unsafe {
        RegGetValueW(
            key,
            subkey,
            value,
            RRF_RT_REG_DWORD,
            None,
            Some(std::ptr::from_mut(&mut data).cast::<c_void>()),
            Some(&mut size),
        )
    }
    .is_ok()
    .then_some(data)
}

/// Writes the apps' and the system's style and tells the running apps.
fn set_dark_style(dark: bool) -> Result<()> {
    let path = HSTRING::from(PERSONALIZE);
    let light = u32::from(!dark);
    for value in [w!("AppsUseLightTheme"), w!("SystemUsesLightTheme")] {
        // SAFETY: `light` is the DWORD the size says.
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(path.as_ptr()),
                value,
                REG_DWORD.0,
                Some(std::ptr::from_ref(&light).cast::<c_void>()),
                std::mem::size_of::<u32>() as u32,
            )
        }
        .ok()?;
    }
    let area = w!("ImmersiveColorSet");
    // SAFETY: `area` is a static NUL-ended string; hung apps are skipped.
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(area.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            BROADCAST_MS,
            None,
        );
    }
    Ok(())
}
