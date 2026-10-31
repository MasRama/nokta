//! The Windows app: a notch window at the top of every monitor, the tray
//! icon, and the commands the page calls.

mod notch_window;
mod topmost;
mod tray;

use tauri::WebviewWindow;

use crate::layout::{self, CssRect, Monitor, NotchSizes};

pub fn run() {
    tauri::Builder::default()
        // A second start leaves the running Nokta alone.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .invoke_handler(tauri::generate_handler![set_hit_region])
        .setup(|app| {
            tray::create(app.handle())?;
            let logical = layout::window_logical_size(&NotchSizes::default());
            let mut notches = Vec::new();
            for (index, found) in app.handle().available_monitors()?.iter().enumerate() {
                let monitor = Monitor {
                    x: found.position().x,
                    y: found.position().y,
                    width: found.size().width,
                    height: found.size().height,
                    scale: found.scale_factor(),
                };
                let window = notch_window::create(app.handle(), index, &monitor, logical)?;
                notches.push(window.hwnd()?);
            }
            topmost::install(&notches);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Nokta could not start");
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
