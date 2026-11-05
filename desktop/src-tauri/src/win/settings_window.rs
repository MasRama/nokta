//! The settings window: an ordinary window with the page `settings.html`,
//! one at a time. The tray, home's Settings tile and starting Nokta again
//! open it.

use std::path::PathBuf;

use tauri::window::Color;
use tauri::{AppHandle, Manager, State, Theme, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

/// Its label; the notch windows' start with `notch-`.
pub const LABEL: &str = "settings";

/// Where config.toml is, for Open config.toml.
pub struct ConfigFile(pub PathBuf);

/// Where the add-on plugins are, for Open Folder.
pub struct PluginsFolder(pub PathBuf);

/// Opens the settings window, or brings it to the front.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("settings.html".into()))
        .title("Nokta Settings")
        .inner_size(960.0, 720.0)
        .min_inner_size(560.0, 420.0)
        .center()
        // The page is dark whatever Windows' style; so are its frame and
        // the first paint.
        .theme(Some(Theme::Dark))
        .background_color(Color(11, 11, 13, 255))
        // A file dropped here is not one for the shelf.
        .disable_drag_drop_handler()
        .build()
        .map(drop)
}

/// Opens the settings window. Async: a window made in a command that runs
/// on the main thread deadlocks on Windows.
#[tauri::command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    open(&app).map_err(|e| e.to_string())
}

/// Opens config.toml in the app Windows opens it with, else Notepad.
#[tauri::command]
pub fn open_config(file: State<'_, ConfigFile>) -> Result<(), String> {
    let path = file.0.to_string_lossy();
    if super::shell_open(&path).is_ok() {
        return Ok(());
    }
    std::process::Command::new("notepad.exe")
        .arg(file.0.as_os_str())
        .spawn()
        .map(drop)
        .map_err(|err| format!("Notepad does not start: {err}"))
}

/// Asks for a picture for the picture theme; None when cancelled.
#[tauri::command]
pub async fn pick_picture(app: AppHandle) -> Option<String> {
    let (done, picked) = oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"]);
    if let Some(window) = app.get_webview_window(LABEL) {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_file(move |file| {
        let _ = done.send(file);
    });
    let path = picked.await.ok()??.into_path().ok()?;
    Some(path.to_string_lossy().into_owned())
}

/// Asks for a plugin's folder, to add it; None when cancelled.
#[tauri::command]
pub async fn pick_plugin_folder(app: AppHandle) -> Option<String> {
    let (done, picked) = oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(window) = app.get_webview_window(LABEL) {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_folder(move |folder| {
        let _ = done.send(folder);
    });
    let path = picked.await.ok()??.into_path().ok()?;
    Some(path.to_string_lossy().into_owned())
}

/// Opens the plugins folder in Explorer, made first if no plugin is there yet.
#[tauri::command]
pub fn open_plugins_folder(folder: State<'_, PluginsFolder>) -> Result<(), String> {
    std::fs::create_dir_all(&folder.0).map_err(|err| err.to_string())?;
    super::shell_open(&folder.0.to_string_lossy())
}
