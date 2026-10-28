//! `nokta`'s commands. `run` works without noktad: the activity is a bonus,
//! the command and its exit code are what the caller depends on.

use std::os::unix::process::ExitStatusExt;
use std::process::{Command, ExitCode, ExitStatus};
use std::time::Duration;

use super::args::Cli;
use super::client::Client;

/// Sent again this often while a command runs, so it never goes stale.
const KEEP_ALIVE: Duration = Duration::from_secs(60);
const RUN_ICON: &str = "utilities-terminal-symbolic";
const EXTENSION_UUID: &str = "nokta@nokta.io";

pub async fn execute(cli: Cli) -> ExitCode {
    match cli {
        Cli::Set {
            id,
            title,
            detail,
            icon,
            progress,
        } => {
            report(async {
                Client::connect()
                    .await?
                    .set(&id, &title, &detail, &icon, progress)
                    .await
            })
            .await
        }
        Cli::End {
            id,
            success,
            message,
        } => report(async { Client::connect().await?.end(&id, success, &message).await }).await,
        Cli::Run {
            title,
            icon,
            command,
        } => run(&title, &icon, &command).await,
        Cli::Settings => settings(),
        Cli::Help | Cli::Version => ExitCode::SUCCESS,
    }
}

/// GNOME Shell opens the extension's settings window.
fn settings() -> ExitCode {
    match Command::new("gnome-extensions")
        .args(["prefs", EXTENSION_UUID])
        .status()
    {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(_) => {
            eprintln!("nokta: GNOME Shell cannot open the settings; is the extension installed?");
            ExitCode::FAILURE
        }
        Err(err) => {
            eprintln!("nokta: cannot run gnome-extensions: {err}");
            ExitCode::FAILURE
        }
    }
}

async fn report(call: impl std::future::Future<Output = zbus::Result<()>>) -> ExitCode {
    match call.await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("nokta: cannot reach noktad: {err}");
            ExitCode::FAILURE
        }
    }
}

async fn run(title: &str, icon: &str, command: &[String]) -> ExitCode {
    let id = format!("run-{}", std::process::id());
    let icon = if icon.is_empty() { RUN_ICON } else { icon };
    let client = match Client::connect().await {
        Ok(client) => match client.set(&id, title, "", icon, -1.0).await {
            Ok(()) => Some(client),
            Err(_) => None,
        },
        Err(_) => None,
    };

    let mut child = match Command::new(&command[0]).args(&command[1..]).spawn() {
        Ok(child) => child,
        Err(err) => {
            eprintln!("nokta: cannot run {}: {err}", command[0]);
            if let Some(client) = &client {
                let _ = client
                    .end(&id, false, &format!("Cannot run {}", command[0]))
                    .await;
            }
            return ExitCode::from(127);
        }
    };
    let mut wait = tokio::task::spawn_blocking(move || child.wait());
    let mut keep_alive = tokio::time::interval(KEEP_ALIVE);
    keep_alive.tick().await;
    let mut interrupted = false;
    let status = loop {
        tokio::select! {
            status = &mut wait => break status.expect("the wait task does not panic"),
            _ = keep_alive.tick() => {
                if let Some(client) = &client {
                    let _ = client.set(&id, title, "", icon, -1.0).await;
                }
            }
            // The terminal sends Ctrl-C to the command too; nokta waits for it.
            _ = tokio::signal::ctrl_c() => interrupted = true,
        }
    };

    let (code, message) = match status {
        Ok(status) => outcome(status, interrupted),
        Err(err) => (1, format!("Cannot wait for the command: {err}")),
    };
    if let Some(client) = &client {
        let _ = client.end(&id, code == 0, &message).await;
    }
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}

/// The exit code to pass on and the message for a failed activity.
fn outcome(status: ExitStatus, interrupted: bool) -> (i32, String) {
    match (status.code(), status.signal()) {
        (Some(0), _) => (0, String::new()),
        (Some(code), _) if interrupted => (code, "Interrupted".into()),
        (Some(code), _) => (code, format!("Exit code {code}")),
        (None, Some(signal)) if interrupted || signal == 2 => (128 + signal, "Interrupted".into()),
        (None, Some(signal)) => (128 + signal, format!("Stopped by signal {signal}")),
        (None, None) => (1, "Stopped".into()),
    }
}
