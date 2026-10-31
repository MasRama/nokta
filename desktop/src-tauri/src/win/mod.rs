//! The Windows app: the core in process, a notch window at the top of every
//! monitor, the tray icon, and the commands the page calls.

mod log;
mod notch_window;
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

/// The part of `window` that takes the pointer, in the page's CSS px.
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
    let region = layout::region_rect(&frame, window.scale_factor().map_err(error)?, rect);
    notch_window::set_region(window.hwnd().map_err(error)?, &region);
    Ok(())
}
