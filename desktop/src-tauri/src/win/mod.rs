//! The Windows app: the core in process, a notch window at the top of every
//! monitor, the tray icon, and the commands the page calls.

mod fullscreen;
mod log;
mod monitors;
mod notch_window;
mod osd;
mod pointer;
mod privacy;
mod services;
mod shelf;
mod shortcut;
mod sound;
mod toggles;
mod topmost;
mod tray;

use std::sync::Mutex;

use nokta_core::shared::paths::Paths;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::layout::{self, CssRect, NotchSizes};

pub fn run() {
    tauri::Builder::default()
        // A second start leaves the running Nokta alone.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .invoke_handler(tauri::generate_handler![
            set_hit_region,
            notch_fullscreen,
            release_keyboard,
            open_uri,
            open_file,
            shelf::shelf_drag,
            services::bridge_props,
            services::bridge_call
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(dragged) = event {
                shelf::dragged_over(window, dragged);
            }
        })
        .setup(|app| {
            let paths = Paths::from_env()?;
            log::init(&paths);
            tracing::info!("Nokta {} starting", env!("CARGO_PKG_VERSION"));
            let core = services::start(app.handle(), &paths);
            let sizes = NotchSizes::from(&core.config().appearance);
            app.manage(core);
            tray::create(app.handle())?;
            monitors::start(app.handle(), layout::window_logical_size(&sizes));
            pointer::start(app.handle().clone());
            fullscreen::start(app.handle().clone());
            shortcut::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Nokta could not start");
}

/// The part of `window` that takes clicks, in the page's CSS px: the notch,
/// with room for its motion while it moves.
#[tauri::command]
fn set_hit_region(window: WebviewWindow, rect: CssRect) -> Result<(), String> {
    {
        let mut hits = HIT_REGIONS.lock().unwrap_or_else(|e| e.into_inner());
        hits.retain(|(label, _)| label != window.label());
        hits.push((window.label().to_owned(), rect));
    }
    apply_hit(&window, rect).map_err(|e| e.to_string())
}

/// Each window's click box as its page last reported it.
static HIT_REGIONS: Mutex<Vec<(String, CssRect)>> = Mutex::new(Vec::new());

/// Places every window's click box again, after the windows moved.
fn refresh_hits(app: &AppHandle) {
    let hits = HIT_REGIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    for (label, rect) in hits {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        if let Err(err) = apply_hit(&window, rect) {
            tracing::warn!("cannot place the click box of {label}: {err}");
        }
    }
}

/// Makes `rect` (in the page's CSS px) of `window` take clicks.
fn apply_hit(window: &WebviewWindow, rect: CssRect) -> tauri::Result<()> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let frame = layout::Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let hit = layout::hit_rect(&frame, window.scale_factor()?, rect);
    pointer::set(window.label(), window.hwnd()?, hit);
    Ok(())
}

/// Whether a fullscreen app covers the monitor of the window that asks.
#[tauri::command]
fn notch_fullscreen(window: WebviewWindow) -> bool {
    fullscreen::is_covered(window.label())
}

/// The notch that asks closed after the open shortcut opened it.
#[tauri::command]
fn release_keyboard(window: WebviewWindow) {
    shortcut::release(window.label());
}

/// Opens `uri` with Windows: one of its panels or a web page.
#[tauri::command]
fn open_uri(uri: String) -> Result<(), String> {
    if !crate::links::may_open(&uri) {
        return Err(format!("Nokta does not open {uri}"));
    }
    shell_open(&uri)
}

/// Opens a file the core announced, like a finished download, or shows it
/// selected in Explorer when `reveal` is set.
#[tauri::command]
fn open_file(
    core: tauri::State<'_, services::Core>,
    uri: String,
    reveal: bool,
) -> Result<(), String> {
    let path = core
        .file_path(&uri)
        .ok_or_else(|| format!("Nokta does not open {uri}"))?;
    if !reveal {
        return shell_open(&path.to_string_lossy());
    }
    use std::os::windows::process::CommandExt;
    // Explorer takes the path after `/select,`, quoted as one argument.
    std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn()
        .map(drop)
        .map_err(|err| format!("Explorer does not start: {err}"))
}

/// Opens `target` as a double-click in Explorer would.
fn shell_open(target: &str) -> Result<(), String> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide = HSTRING::from(target);
    // SAFETY: `wide` is a NUL-ended string that outlives the call.
    let done = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(wide.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // Above 32 is success, as ShellExecute has it.
    if done.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("Windows cannot open {target}"))
    }
}
