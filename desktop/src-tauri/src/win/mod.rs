//! The Windows app: the core in process, a notch window at the top of every
//! monitor, the tray icon, and the commands the page calls.

mod fullscreen;
mod log;
mod notch_window;
mod osd;
mod pointer;
mod privacy;
mod services;
mod topmost;
mod tray;

use nokta_core::shared::paths::Paths;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::layout::{self, CssRect, Monitor, NotchSizes};

pub fn run() {
    tauri::Builder::default()
        // A second start leaves the running Nokta alone.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .invoke_handler(tauri::generate_handler![
            set_hit_region,
            notch_fullscreen,
            services::bridge_props,
            services::bridge_call
        ])
        .setup(|app| {
            let paths = Paths::from_env()?;
            log::init(&paths);
            tracing::info!("Nokta {} starting", env!("CARGO_PKG_VERSION"));
            let core = services::start(app.handle(), &paths);
            let sizes = NotchSizes::from(&core.config().appearance);
            app.manage(core);
            tray::create(app.handle())?;
            let logical = layout::window_logical_size(&sizes);
            let mut notches = Vec::new();
            for (index, found) in app.handle().available_monitors()?.iter().enumerate() {
                let window =
                    notch_window::create(app.handle(), index, &monitor_of(found), logical)?;
                notches.push(window.hwnd()?);
            }
            topmost::install(&notches);
            pointer::start(app.handle().clone());
            fullscreen::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Nokta could not start");
}

fn monitor_of(found: &tauri::Monitor) -> Monitor {
    Monitor {
        x: found.position().x,
        y: found.position().y,
        width: found.size().width,
        height: found.size().height,
        scale: found.scale_factor(),
    }
}

/// Gives every notch window the size `sizes` need, on its own monitor.
fn fit_windows(app: &AppHandle, sizes: &NotchSizes) {
    let logical = layout::window_logical_size(sizes);
    for (label, window) in app.webview_windows() {
        if !label.starts_with("notch-") {
            continue;
        }
        let Ok(Some(found)) = window.current_monitor() else {
            continue;
        };
        if let Err(err) = notch_window::place(&window, &monitor_of(&found), logical) {
            tracing::warn!("cannot fit {label}: {err}");
        }
    }
}

/// The part of `window` that takes clicks, in the page's CSS px: the notch,
/// with room for its motion while it moves.
#[tauri::command]
fn set_hit_region(window: WebviewWindow, rect: CssRect) -> Result<(), String> {
    let error = |e: tauri::Error| e.to_string();
    let position = window.outer_position().map_err(error)?;
    let size = window.outer_size().map_err(error)?;
    let frame = layout::Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let hit = layout::hit_rect(&frame, window.scale_factor().map_err(error)?, rect);
    pointer::set(window.label(), window.hwnd().map_err(error)?, hit);
    Ok(())
}

/// Whether a fullscreen app covers the monitor of the window that asks.
#[tauri::command]
fn notch_fullscreen(window: WebviewWindow) -> bool {
    fullscreen::is_covered(window.label())
}
