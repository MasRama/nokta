//! The first-run tour: the notch on the primary monitor shows it once, and
//! the settings window's Show the tour again shows it there once more.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use windows::Win32::Foundation::HWND;

use super::monitors;
use crate::state;

/// The event that tells a notch to show the tour (desktop/src/platform.ts).
const TOUR_EVENT: &str = "nokta://tour";

/// `%APPDATA%\nokta\state.toml`.
pub struct StateFile(pub PathBuf);

/// The label of the notch on the primary monitor.
fn primary(app: &AppHandle) -> Option<String> {
    // A null window stands for the primary monitor.
    monitors::notch_on_monitor_of(app, HWND(std::ptr::null_mut()))
        .map(|window| window.label().to_owned())
}

fn read(file: &StateFile) -> String {
    std::fs::read_to_string(&file.0).unwrap_or_default()
}

fn write_shown(file: &StateFile, shown: bool) -> Result<(), String> {
    let text = state::with_tour_shown(&read(file), shown);
    if let Some(dir) = file.0.parent() {
        std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    std::fs::write(&file.0, text).map_err(|err| format!("cannot write {}: {err}", file.0.display()))
}

/// Whether the notch that asks shows the tour: it is on the primary monitor
/// and the tour never ended.
#[tauri::command]
pub fn tour_wanted(window: WebviewWindow, file: State<'_, StateFile>) -> bool {
    !state::tour_shown(&read(&file))
        && primary(window.app_handle()).as_deref() == Some(window.label())
}

/// The tour ended: Done, Skip, Escape or a click elsewhere.
#[tauri::command]
pub fn tour_done(file: State<'_, StateFile>) -> Result<(), String> {
    write_shown(&file, true)
}

/// The settings window's Show the tour again: the primary notch shows it.
#[tauri::command]
pub fn show_tour(app: AppHandle, file: State<'_, StateFile>) -> Result<(), String> {
    write_shown(&file, false)?;
    let label = primary(&app).ok_or("no notch shows")?;
    app.emit_to(label.as_str(), TOUR_EVENT, ())
        .map_err(|err| err.to_string())
}
