//! Starts `nokta update --yes` in a transient systemd user unit, outside
//! `nokta.service`, so the installer's restart of noktad does not stop it.

use std::path::{Path, PathBuf};

/// The `nokta` next to the running `noktad`.
fn nokta_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|err| format!("cannot find noktad: {err}"))?;
    // Linux names a replaced executable "noktad (deleted)".
    let dir = exe.parent().unwrap_or(Path::new("/"));
    let nokta = dir.join("nokta");
    if nokta.is_file() {
        Ok(nokta)
    } else {
        Err(format!("nokta is not in {}", dir.display()))
    }
}

pub async fn start() -> Result<(), String> {
    let nokta = nokta_path()?;
    let output = tokio::process::Command::new("systemd-run")
        .args([
            "--user",
            "--collect",
            "--quiet",
            "--unit=nokta-update",
            "--",
        ])
        .arg(&nokta)
        .args(["update", "--yes"])
        .output()
        .await
        .map_err(|err| format!("cannot run systemd-run: {err}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("cannot start the update: {}", err.trim()))
    }
}
