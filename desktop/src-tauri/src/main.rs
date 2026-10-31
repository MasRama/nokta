//! Nokta for Windows. On other systems this binary only says so: Linux has
//! the GNOME Shell extension.

// No console window behind the notch in a release build.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod bridge;
mod clipboard;
mod files;
mod fullscreen;
mod layout;
mod links;
mod monitors;
mod osd;
mod privacy;
mod shortcut;
mod state;
mod toast;
#[cfg(windows)]
mod win;

fn main() {
    #[cfg(windows)]
    win::run();
    #[cfg(not(windows))]
    {
        eprintln!("nokta-desktop runs on Windows; on Linux Nokta is the GNOME extension");
        std::process::exit(1);
    }
}
