//! Nokta for Windows. On other systems this binary only says so: Linux has
//! the GNOME Shell extension.

// No console window behind the notch in a release build.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod bridge;
mod fullscreen;
mod layout;
mod osd;
mod privacy;
mod shortcut;
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
