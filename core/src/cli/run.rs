//! `nokta`'s commands. `run` works without Nokta: the activity is a bonus,
//! the command and its exit code are what the caller depends on.

use std::process::{Command, ExitCode, ExitStatus};
use std::time::Duration;

use super::args::Cli;
use super::client::{CallError, Client};
use super::local_time::next_time_of_day;

/// Sent again this often while a command runs, so it never goes stale.
const KEEP_ALIVE: Duration = Duration::from_secs(60);
const RUN_ICON: &str = "utilities-terminal-symbolic";
#[cfg(target_os = "linux")]
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
            call(|nokta| async move { nokta.set(&id, &title, &detail, &icon, progress).await })
                .await
        }
        Cli::End {
            id,
            success,
            message,
        } => call(|nokta| async move { nokta.end(&id, success, &message).await }).await,
        Cli::Run {
            title,
            icon,
            command,
        } => run(&title, &icon, &command).await,
        Cli::Countdown { duration_us, label } => {
            call(|nokta| async move { nokta.add_countdown(&label, duration_us).await }).await
        }
        Cli::Stopwatch { label } => {
            call(|nokta| async move { nokta.add_stopwatch(&label).await }).await
        }
        Cli::Alarm {
            hour,
            minute,
            label,
        } => alarm(hour, minute, label).await,
        Cli::ClearClocks => call(|nokta| async move { nokta.clear_clocks().await }).await,
        Cli::Settings => settings().await,
        Cli::Update { yes, check_only } => super::update::update(yes, check_only).await,
        Cli::Help | Cli::Version => ExitCode::SUCCESS,
    }
}

/// The app opens its settings window.
#[cfg(windows)]
async fn settings() -> ExitCode {
    call(|nokta| async move { nokta.open_settings().await }).await
}

/// GNOME Shell opens the extension's settings window.
#[cfg(target_os = "linux")]
async fn settings() -> ExitCode {
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

async fn alarm(hour: u8, minute: u8, label: String) -> ExitCode {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(0));
    let Some(at) = next_time_of_day(hour, minute, now) else {
        eprintln!("nokta: {hour:02}:{minute:02} does not happen in the next day here");
        return ExitCode::FAILURE;
    };
    call(|nokta| async move { nokta.add_alarm(&label, at * 1_000_000).await }).await
}

/// Makes one call and says why it failed, if it did.
async fn call<F, Fut>(call: F) -> ExitCode
where
    F: FnOnce(Client) -> Fut,
    Fut: std::future::Future<Output = Result<(), CallError>>,
{
    let result = match Client::connect().await {
        Ok(nokta) => call(nokta).await,
        Err(err) => Err(err),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("nokta: {err}");
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
#[cfg(unix)]
fn outcome(status: ExitStatus, interrupted: bool) -> (i32, String) {
    use std::os::unix::process::ExitStatusExt;

    match (status.code(), status.signal()) {
        (Some(0), _) => (0, String::new()),
        (Some(code), _) if interrupted => (code, "Interrupted".into()),
        (Some(code), _) => (code, format!("Exit code {code}")),
        (None, Some(signal)) if interrupted || signal == 2 => (128 + signal, "Interrupted".into()),
        (None, Some(signal)) => (128 + signal, format!("Stopped by signal {signal}")),
        (None, None) => (1, "Stopped".into()),
    }
}

/// The exit code to pass on and the message for a failed activity. Ctrl-C
/// ends a console program with STATUS_CONTROL_C_EXIT.
#[cfg(windows)]
fn outcome(status: ExitStatus, interrupted: bool) -> (i32, String) {
    const CONTROL_C_EXIT: i32 = 0xC000_013A_u32 as i32;
    match status.code() {
        Some(0) => (0, String::new()),
        Some(code) if interrupted || code == CONTROL_C_EXIT => (code, "Interrupted".into()),
        Some(code) => (code, format!("Exit code {code}")),
        None => (1, "Stopped".into()),
    }
}
