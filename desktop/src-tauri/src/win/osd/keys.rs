//! The keys behind Windows' own OSD, from a low-level keyboard hook: when a
//! volume key last went down, for the volume to show, and, for a moment
//! after a key that may change them comes up, the lock keys and the
//! keyboard layout. The hook is called on this thread, from its message
//! loop, which also reads the lock keys and the layout on a timer.

use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::mpsc;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::Globalization::{
    GetLocaleInfoEx, LCIDToLocaleName, LOCALE_SLOCALIZEDDISPLAYNAME,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, GetKeyboardLayout, GetKeyboardLayoutList, VK_CAPITAL, VK_LSHIFT, VK_LWIN,
    VK_NUMLOCK, VK_RMENU, VK_RWIN, VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, KillTimer,
    SetTimer, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN,
    WM_SYSKEYDOWN, WM_TIMER,
};

use crate::osd::{layout_language, Layouts, Locks, Osd};

/// How often the lock keys and the layout are read after a key, in ms,
const POLL_MS: u32 = 150;
/// and how many times: an app takes a moment to switch its layout.
const POLLS: u8 = 4;

/// When a volume key last went down, in ms since boot; 0 is never.
static VOLUME_KEY_AT: AtomicU64 = AtomicU64::new(0);

/// When a volume key last went down, in ms since boot; 0 is never.
pub fn volume_key_at() -> u64 {
    VOLUME_KEY_AT.load(Ordering::Relaxed)
}

/// Now, in ms since boot.
pub fn now_ms() -> u64 {
    // SAFETY: reads the tick count.
    unsafe { GetTickCount64() }
}

struct Watch {
    osd: mpsc::Sender<Osd>,
    locks: Locks,
    layouts: Layouts,
    polls_left: u8,
    /// The poll timer's id; 0 while it is off.
    timer: usize,
}

thread_local! {
    static WATCH: RefCell<Option<Watch>> = const { RefCell::new(None) };
}

/// Hooks the keyboard and runs this thread's message loop, for good.
pub fn run(osd: mpsc::Sender<Osd>) {
    let mut watch = Watch {
        osd,
        locks: Locks::default(),
        layouts: Layouts::default(),
        polls_left: 0,
        timer: 0,
    };
    // Learns where the lock keys and the layout are.
    poll(&mut watch);
    WATCH.with_borrow_mut(|slot| *slot = Some(watch));
    // SAFETY: the module is this program's; the hook procedure lives as
    // long as it.
    let hooked = unsafe {
        let module = GetModuleHandleW(PCWSTR::null()).ok();
        SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(on_key),
            module.map(|m| HINSTANCE(m.0)),
            0,
        )
    };
    if let Err(err) = hooked {
        tracing::warn!("no lock key or layout OSD: {err}");
        return;
    }
    let mut msg = MSG::default();
    // SAFETY: `msg` is a valid place for the next message. GetMessageW
    // calls the hook and returns the timer's messages; -1 is an error.
    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {
        if msg.message == WM_TIMER {
            WATCH.with_borrow_mut(|slot| {
                if let Some(watch) = slot {
                    tick(watch);
                }
            });
        }
    }
}

/// The hook: notes a volume key, and reads the lock keys and the layout
/// again after a key that may change them comes up. Kept short, as Windows
/// drops a hook that keeps the keyboard waiting.
unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        // SAFETY: with HC_ACTION, `lparam` points to the key's data.
        let key = unsafe { (*(lparam.0 as *const KBDLLHOOKSTRUCT)).vkCode };
        let message = wparam.0 as u32;
        let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        if down && is_volume_key(key) {
            VOLUME_KEY_AT.store(now_ms(), Ordering::Relaxed);
        } else if !down && may_switch(key) {
            // Never while the loop holds it: the hook only runs inside
            // GetMessageW.
            WATCH.with(|slot| {
                if let Ok(mut slot) = slot.try_borrow_mut() {
                    if let Some(watch) = slot.as_mut() {
                        start_polling(watch);
                    }
                }
            });
        }
    }
    // SAFETY: passes the key on as it came.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn is_volume_key(key: u32) -> bool {
    [VK_VOLUME_UP, VK_VOLUME_DOWN, VK_VOLUME_MUTE]
        .iter()
        .any(|vk| u32::from(vk.0) == key)
}

/// The lock keys, and the modifiers that switch layouts with Alt+Shift,
/// Ctrl+Shift or Win+Space.
fn may_switch(key: u32) -> bool {
    // Left and right Shift, Ctrl and Alt.
    let modifiers = u32::from(VK_LSHIFT.0)..=u32::from(VK_RMENU.0);
    modifiers.contains(&key)
        || [VK_CAPITAL, VK_NUMLOCK, VK_LWIN, VK_RWIN]
            .iter()
            .any(|vk| u32::from(vk.0) == key)
}

fn start_polling(watch: &mut Watch) {
    watch.polls_left = POLLS;
    if watch.timer == 0 {
        // SAFETY: a thread timer: its messages come to this thread's loop.
        watch.timer = unsafe { SetTimer(None, 0, POLL_MS, None) };
    }
}

fn tick(watch: &mut Watch) {
    poll(watch);
    watch.polls_left = watch.polls_left.saturating_sub(1);
    if watch.polls_left == 0 && watch.timer != 0 {
        // SAFETY: the timer is this thread's.
        let _ = unsafe { KillTimer(None, watch.timer) };
        watch.timer = 0;
    }
}

/// Reads the lock keys and the foreground window's layout, and sends what
/// changed.
fn poll(watch: &mut Watch) {
    // SAFETY: the reads below take plain values and handles.
    let (caps, num, window, layout, count) = unsafe {
        let window = GetForegroundWindow();
        let thread = GetWindowThreadProcessId(window, None);
        (
            GetKeyState(i32::from(VK_CAPITAL.0)) & 1 != 0,
            GetKeyState(i32::from(VK_NUMLOCK.0)) & 1 != 0,
            window,
            GetKeyboardLayout(thread),
            GetKeyboardLayoutList(None),
        )
    };
    for osd in watch.locks.update(caps, num) {
        let _ = watch.osd.try_send(osd);
    }
    if window.is_invalid() {
        return;
    }
    let count = usize::try_from(count).unwrap_or(0);
    if watch
        .layouts
        .update(window.0 as isize, layout.0 as isize, count)
    {
        if let Some(name) = language_name(layout_language(layout.0 as isize)) {
            let _ = watch.osd.try_send(Osd::Layout(name));
        }
    }
}

/// The language's name in the user's own language, e.g. "English (United
/// States)".
fn language_name(language: u32) -> Option<String> {
    // LOCALE_NAME_MAX_LENGTH.
    let mut locale = [0u16; 85];
    // SAFETY: both buffers are ours and sized as passed.
    let written = unsafe { LCIDToLocaleName(language, Some(&mut locale), 0) };
    if written <= 0 {
        return None;
    }
    let mut name = [0u16; 128];
    let written = unsafe {
        GetLocaleInfoEx(
            PCWSTR(locale.as_ptr()),
            LOCALE_SLOCALIZEDDISPLAYNAME,
            Some(&mut name),
        )
    };
    // The count takes in the closing NUL.
    let len = usize::try_from(written).ok()?.checked_sub(1)?;
    (len > 0).then(|| String::from_utf16_lossy(&name[..len]))
}
