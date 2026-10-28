//! `nokta`: shows a script's work in the notch. See `nokta --help`.

use std::process::ExitCode;

use nokta_core::cli::args::{parse, Cli};

const USAGE: &str = "\
Usage:
  nokta run [--title TITLE] [--icon NAME] -- COMMAND [ARGS...]
  nokta activity set ID --title TITLE [--detail TEXT] [--icon NAME] [--progress 0-100]
  nokta activity end ID [--failed] [--message TEXT]
  nokta timer LENGTH [LABEL...]
  nokta timer clear
  nokta stopwatch [LABEL...]
  nokta alarm HH:MM [LABEL...]
  nokta settings
  nokta --version | --help

run shows COMMAND in the notch while it runs, then how it ended, and exits
with its exit code. It runs the command even when noktad is not there.

activity set starts or updates an activity; without --progress the progress
is unknown. activity end removes it, as a success unless --failed is given.
An activity with no update for [activities] stale_minutes ends by itself.

timer starts a countdown, like 10m, 1h30m or 45s (a bare number is
minutes); timer clear removes every countdown, stopwatch and alarm.
stopwatch starts a stopwatch. alarm rings at the next HH:MM on the local
24-hour clock, today or tomorrow. The notch shows them all, at most 6.

settings opens Nokta's settings window.

Icon names are theme icons, like drive-harddisk-symbolic.";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cli = match parse(&args) {
        Ok(cli) => cli,
        Err(err) => {
            eprintln!("nokta: {err}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match cli {
        Cli::Help => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Cli::Version => {
            println!("nokta {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        cli => execute(cli),
    }
}

#[cfg(target_os = "linux")]
fn execute(cli: Cli) -> ExitCode {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a Tokio runtime")
        .block_on(nokta_core::cli::run::execute(cli))
}

#[cfg(not(target_os = "linux"))]
fn execute(_cli: Cli) -> ExitCode {
    eprintln!("nokta: Nokta has no frontend on this system yet");
    ExitCode::FAILURE
}
