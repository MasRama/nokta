//! `noktad`: the Nokta daemon. See `app` for what it does.

use std::io::IsTerminal;
use std::process::ExitCode;

use nokta_core::app::{self, RunOptions, DEFAULT_LRCLIB_URL};
use nokta_core::shared::paths::Paths;
use tracing_subscriber::EnvFilter;

const USAGE: &str = "\
Usage: noktad [--version | --help]

Runs the Nokta daemon on the session bus. It is normally started by D-Bus
activation through the nokta.service systemd user unit.

Environment:
  NOKTA_LOG         log filter, e.g. debug or nokta_core=trace (default: info)
  NOKTA_LRCLIB_URL  LRCLIB base URL (default: https://lrclib.net)";

fn main() -> ExitCode {
    match std::env::args().nth(1).as_deref() {
        None => {}
        Some("--version" | "-V") => {
            println!("noktad {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Some("--help" | "-h") => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Some(other) => {
            eprintln!("noktad: unknown argument '{other}'\n\n{USAGE}");
            return ExitCode::from(2);
        }
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_env("NOKTA_LOG").unwrap_or_else(|_| "info".into()))
        .with_writer(std::io::stderr)
        .with_ansi(std::io::stderr().is_terminal())
        .init();

    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            tracing::error!("{err:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> anyhow::Result<()> {
    let paths = Paths::from_env()?;
    let lrclib_base_url = std::env::var("NOKTA_LRCLIB_URL")
        .ok()
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_LRCLIB_URL.to_owned());
    let options = RunOptions {
        bus_address: None,
        system_bus_address: None,
        lrclib_base_url,
    };
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(app::run(paths, options))
}
