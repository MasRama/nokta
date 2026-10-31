//! The tray icon: Windows has no top bar, so this is where Nokta can be
//! quit.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "Quit Nokta", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;
    let mut tray = TrayIconBuilder::with_id("nokta")
        .tooltip("Nokta")
        .menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| {
        if event.id().as_ref() == "quit" {
            app.exit(0);
        }
    })
    .build(app)?;
    Ok(())
}
