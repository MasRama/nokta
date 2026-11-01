//! Home's Update: starts `bin\nokta.exe update --yes` beside the app, as
//! noktad starts `nokta update` on Linux. It shows itself as the activity
//! `update:nokta`, then its setup closes Nokta, installs it and starts it
//! again.

use std::os::windows::process::CommandExt;
use std::process::Command;

/// No console window for it.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn start() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|err| format!("cannot find Nokta: {err}"))?;
    let nokta = exe
        .parent()
        .ok_or("Nokta is in no folder")?
        .join("bin")
        .join("nokta.exe");
    if !nokta.is_file() {
        return Err(format!("{} is not there", nokta.display()));
    }
    Command::new(&nokta)
        .args(["update", "--yes"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(drop)
        .map_err(|err| format!("cannot start the update: {err}"))
}
