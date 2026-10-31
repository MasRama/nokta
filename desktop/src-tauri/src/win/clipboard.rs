//! Windows' clipboard for the history: each copy goes to the core, as the
//! extension's watcher sends GNOME's, and an entry the page picks goes back
//! on the clipboard. A message-only window on its own thread listens for
//! copies and owns what Nokta puts there.

use std::ffi::c_void;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use nokta_core::features::clipboard::model::{Content, MAX_IMAGE_BYTES, MAX_TEXT_BYTES};
use nokta_core::features::clipboard::service::{Command, Published};
use nokta_core::features::settings::Config;
use tokio::sync::{mpsc, watch};
use windows::core::{w, Error, PCWSTR};
use windows::Win32::Foundation::{
    GlobalFree, HANDLE, HGLOBAL, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData,
    IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Ole::{CF_DIB, CF_DIBV5, CF_UNICODETEXT};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, RegisterClassW,
    HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_CLIPBOARDUPDATE, WNDCLASSW,
};

use crate::clipboard::{capture_kind, png_to_dib, text_from_wide, wide_from_text, Kind, Offer};

/// Asks the window to put the pending entry on the clipboard.
const WM_PUT: u32 = WM_APP + 1;
/// Another app may hold the clipboard for a moment: tries this often,
const OPEN_TRIES: u32 = 10;
/// this many ms apart.
const OPEN_WAIT_MS: u64 = 20;
/// A `CF_DIB` this large is not read: `dib_to_png` takes 40M pixels.
const MAX_DIB_BYTES: usize = 160 * 1024 * 1024;

/// What the window's procedure needs.
struct Watch {
    commands: mpsc::Sender<Command>,
    config: watch::Receiver<Config>,
    state: watch::Receiver<Published>,
    formats: Formats,
}

/// The registered formats the history reads; 0 for one Windows refused.
struct Formats {
    png: u32,
    exclude: u32,
    history: u32,
}

static WATCH: OnceLock<Watch> = OnceLock::new();

/// The window, once it listens; null before.
static WINDOW: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

/// The entry `copy` asked for, until the window puts it on the clipboard.
static PENDING: Mutex<Option<Content>> = Mutex::new(None);

/// Follows the clipboard on a thread of its own, for good.
pub fn spawn(
    commands: mpsc::Sender<Command>,
    config: watch::Receiver<Config>,
    state: watch::Receiver<Published>,
) {
    let started = std::thread::Builder::new()
        .name("nokta-clipboard".into())
        .spawn(move || run(commands, config, state));
    if let Err(err) = started {
        tracing::warn!("no clipboard history: {err}");
    }
}

/// Puts `content` on Windows' clipboard, from the window that owns it.
pub fn copy(content: Content) -> Result<(), String> {
    let window = WINDOW.load(Ordering::Acquire);
    if window.is_null() {
        return Err("Nokta does not follow the clipboard".into());
    }
    *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(content);
    // SAFETY: the window lives as long as the program.
    unsafe { PostMessageW(Some(HWND(window)), WM_PUT, WPARAM(0), LPARAM(0)) }
        .map_err(|err| format!("cannot copy: {err}"))
}

fn run(
    commands: mpsc::Sender<Command>,
    config: watch::Receiver<Config>,
    state: watch::Receiver<Published>,
) {
    let formats = Formats {
        png: register(w!("PNG")),
        exclude: register(w!("ExcludeClipboardContentFromMonitorProcessing")),
        history: register(w!("CanIncludeInClipboardHistory")),
    };
    let _ = WATCH.set(Watch {
        commands,
        config,
        state,
        formats,
    });
    let hwnd = match listen() {
        Ok(hwnd) => hwnd,
        Err(err) => {
            tracing::warn!("no clipboard history: {err}");
            return;
        }
    };
    WINDOW.store(hwnd.0, Ordering::Release);
    let mut msg = MSG::default();
    // SAFETY: `msg` is a valid place for the next message; -1 is an error.
    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {
        // SAFETY: a message GetMessageW returned.
        unsafe { DispatchMessageW(&msg) };
    }
}

/// Makes the message-only window and listens for copies.
fn listen() -> windows::core::Result<HWND> {
    let class = w!("NoktaClipboard");
    // SAFETY: the class and its procedure live as long as the program; the
    // window has no parent but the message-only one.
    unsafe {
        let instance = GetModuleHandleW(PCWSTR::null())
            .map(|module| HINSTANCE(module.0))
            .unwrap_or_default();
        let wc = WNDCLASSW {
            lpfnWndProc: Some(on_message),
            hInstance: instance,
            lpszClassName: class,
            ..Default::default()
        };
        if RegisterClassW(&wc) == 0 {
            return Err(Error::from_thread());
        }
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class,
            w!("Nokta clipboard"),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        )?;
        AddClipboardFormatListener(hwnd)?;
        Ok(hwnd)
    }
}

unsafe extern "system" fn on_message(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CLIPBOARDUPDATE => copied(hwnd),
        WM_PUT => put_pending(hwnd),
        // SAFETY: the window's own message, passed on as it came.
        _ => return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
    LRESULT(0)
}

/// Sends what was copied to the history, while it is on and not paused.
fn copied(hwnd: HWND) {
    let Some(watch) = WATCH.get() else {
        return;
    };
    // Nothing is read while the history is off.
    if !watch.config.borrow().clipboard.enabled || watch.state.borrow().paused {
        return;
    }
    let Some(content) = read(hwnd, &watch.formats) else {
        return;
    };
    if let Err(err) = watch.commands.try_send(Command::Add(content)) {
        tracing::warn!("cannot keep a copy: {err}");
    }
}

/// What the clipboard holds, as the history keeps it.
fn read(hwnd: HWND, formats: &Formats) -> Option<Content> {
    let _open = Opened::new(hwnd)?;
    let offer = Offer {
        secret: available(formats.exclude)
            || (available(formats.history)
                && data::<u32>(formats.history, 64).is_some_and(|value| value.first() == Some(&0))),
        text: available(CF_UNICODETEXT.0.into()),
        png: available(formats.png),
        dib: available(CF_DIBV5.0.into()) || available(CF_DIB.0.into()),
    };
    match capture_kind(offer)? {
        Kind::Text => {
            // Each UTF-16 unit is at least one UTF-8 byte, and the NUL.
            let units = data::<u16>(CF_UNICODETEXT.0.into(), (MAX_TEXT_BYTES + 1) * 2)?;
            Content::new("text", &text_from_wide(&units), Vec::new())
        }
        Kind::Image => {
            let png = if offer.png {
                data::<u8>(formats.png, MAX_IMAGE_BYTES)
            } else {
                None
            };
            let png = png.or_else(|| {
                // Windows makes a DIBV5 of a DIB and back, so either reads.
                let dib = data::<u8>(CF_DIBV5.0.into(), MAX_DIB_BYTES)
                    .or_else(|| data::<u8>(CF_DIB.0.into(), MAX_DIB_BYTES))?;
                crate::clipboard::dib_to_png(&dib)
            })?;
            Content::new("image", "", png)
        }
    }
}

/// Puts the entry `copy` asked for on the clipboard.
fn put_pending(hwnd: HWND) {
    let Some(content) = PENDING.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return;
    };
    let png = WATCH.get().map_or(0, |watch| watch.formats.png);
    if let Err(err) = put(hwnd, &content, png) {
        tracing::warn!("cannot copy a clipboard entry: {err}");
    }
}

fn put(hwnd: HWND, content: &Content, png: u32) -> Result<(), String> {
    let _open = Opened::new(hwnd).ok_or("another app holds the clipboard")?;
    let put = || -> windows::core::Result<()> {
        // SAFETY: the clipboard is open; emptying it makes `hwnd` its owner.
        unsafe { EmptyClipboard() }?;
        match content {
            Content::Text(text) => set(CF_UNICODETEXT.0.into(), &wide_from_text(text)),
            Content::Image(image) => {
                // The PNG for apps that read it, which keeps transparency;
                // the DIB for every other.
                if png != 0 {
                    set(png, image)?;
                }
                match png_to_dib(image) {
                    Some(dib) => set(CF_DIB.0.into(), &dib),
                    None => Ok(()),
                }
            }
        }
    };
    put().map_err(|err| err.to_string())
}

/// The clipboard, open for this window until dropped.
struct Opened;

impl Opened {
    fn new(hwnd: HWND) -> Option<Opened> {
        for _ in 0..OPEN_TRIES {
            // SAFETY: opened for the window, closed on drop.
            if unsafe { OpenClipboard(Some(hwnd)) }.is_ok() {
                return Some(Opened);
            }
            std::thread::sleep(Duration::from_millis(OPEN_WAIT_MS));
        }
        tracing::debug!("another app holds the clipboard");
        None
    }
}

impl Drop for Opened {
    fn drop(&mut self) {
        // SAFETY: this window opened it.
        let _ = unsafe { CloseClipboard() };
    }
}

fn register(name: PCWSTR) -> u32 {
    // SAFETY: `name` is a static string.
    unsafe { RegisterClipboardFormatW(name) }
}

fn available(format: u32) -> bool {
    // SAFETY: only asks whether the clipboard has the format.
    format != 0 && unsafe { IsClipboardFormatAvailable(format) }.is_ok()
}

/// The clipboard's `format` as items of `T`, or None when it has none or
/// it is over `max_bytes`. The clipboard must be open.
fn data<T: Copy>(format: u32, max_bytes: usize) -> Option<Vec<T>> {
    // SAFETY: the handle is the clipboard's, read under its lock and not
    // kept; the size is the global's own.
    unsafe {
        let handle = GetClipboardData(format).ok()?;
        let global = HGLOBAL(handle.0);
        let size = GlobalSize(global);
        if size == 0 || size > max_bytes {
            return None;
        }
        let start = GlobalLock(global) as *const T;
        if start.is_null() {
            return None;
        }
        let items = std::slice::from_raw_parts(start, size / size_of::<T>()).to_vec();
        let _ = GlobalUnlock(global);
        Some(items)
    }
}

/// Hands `items` to the open clipboard as `format`.
fn set<T: Copy>(format: u32, items: &[T]) -> windows::core::Result<()> {
    // SAFETY: the memory is ours until SetClipboardData takes it, freed if
    // it does not.
    unsafe {
        let global = GlobalAlloc(GMEM_MOVEABLE, size_of_val(items))?;
        let start = GlobalLock(global) as *mut T;
        if start.is_null() {
            let err = Error::from_thread();
            let _ = GlobalFree(Some(global));
            return Err(err);
        }
        std::ptr::copy_nonoverlapping(items.as_ptr(), start, items.len());
        let _ = GlobalUnlock(global);
        if let Err(err) = SetClipboardData(format, Some(HANDLE(global.0))) {
            let _ = GlobalFree(Some(global));
            return Err(err);
        }
    }
    Ok(())
}
