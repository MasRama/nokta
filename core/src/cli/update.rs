//! `nokta update`: installs the latest release from GitHub. The tarball must
//! match the release's SHA256SUMS before anything is unpacked; its own
//! `install.sh` then replaces noktad, nokta and the extension and restarts
//! noktad. The notch shows it as the activity `update:nokta` meanwhile.

use std::io::{BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use futures_util::StreamExt;

use super::client::Client;
use crate::app::USER_AGENT;
use crate::features::updates::github::{self, checked, Release};
use crate::features::updates::model::{check_sum, newer, tarball_name};
use crate::shared::http;
use crate::shared::paths::Paths;

const CURRENT: &str = env!("CARGO_PKG_VERSION");
const ACTIVITY: &str = "update:nokta";
const ICON: &str = "software-update-available-symbolic";
const SUMS: &str = "SHA256SUMS";
/// The activity's texts; the extension translates them, so they carry no version.
const TITLE: &str = "Updating Nokta";

pub async fn update(yes: bool, check_only: bool) -> ExitCode {
    let api_url = std::env::var("NOKTA_GITHUB_API_URL")
        .ok()
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| github::DEFAULT_API_URL.to_owned());
    let release = match github::Client::new(&api_url, USER_AGENT).latest().await {
        Ok(release) => release,
        Err(err) => return fail(&format!("cannot find the latest release: {err}")),
    };
    let Some(version) = newer(CURRENT, &release.tag) else {
        println!("Nokta {CURRENT} is the newest.");
        return ExitCode::SUCCESS;
    };
    println!(
        "Nokta {version} is available (you have {CURRENT}): {}",
        release.url
    );
    if check_only {
        return ExitCode::SUCCESS;
    }
    if std::env::consts::ARCH != "x86_64" {
        return fail("releases are built for x86_64 only; build Nokta from source instead");
    }
    if !yes {
        if !std::io::stdin().is_terminal() {
            return fail("add --yes to update without being asked");
        }
        if !confirmed() {
            return ExitCode::SUCCESS;
        }
    }
    let dir = match Paths::from_env() {
        Ok(paths) => paths.cache_dir.join("update"),
        Err(err) => return fail(&format!("cannot find the cache folder: {err:#}")),
    };

    let activity = Client::connect().await.ok();
    let say = |detail: &'static str, progress: f64| {
        let activity = activity.as_ref();
        async move {
            if let Some(a) = activity {
                let _ = a.set(ACTIVITY, TITLE, detail, ICON, progress).await;
            }
        }
    };
    let result = install(&release, &version, &dir, &say).await;
    // A restarted noktad no longer knows the activity; this ends it where
    // the old one still runs.
    if let Some(a) = &activity {
        let _ = a.end(ACTIVITY, result.is_ok(), "").await;
    }
    match result {
        Ok(()) => {
            println!("Nokta {version} is installed. Log out and back in to finish.");
            ExitCode::SUCCESS
        }
        Err(err) => fail(&err),
    }
}

async fn install<F, Fut>(
    release: &Release,
    version: &str,
    dir: &Path,
    say: &F,
) -> Result<(), String>
where
    F: Fn(&'static str, f64) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let name = tarball_name(version);
    let tarball = release
        .asset(&name)
        .ok_or_else(|| format!("the release has no {name}"))?;
    let sums = release.asset(SUMS).ok_or_else(|| {
        format!("the release has no {SUMS}, so its download cannot be checked; update by hand")
    })?;

    // Only the update being installed is kept.
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).map_err(|err| format!("cannot make {}: {err}", dir.display()))?;
    let http = http::client(|b| b.user_agent(USER_AGENT));

    say("Downloading", -1.0).await;
    let sums = download(&http, &sums.url, |_| async {})
        .await
        .map_err(|err| format!("cannot download {SUMS}: {err}"))?;
    let sums = String::from_utf8_lossy(&sums).into_owned();
    println!("Downloading {name}");
    let data = download(&http, &tarball.url, |done| say("Downloading", done))
        .await
        .map_err(|err| format!("cannot download {name}: {err}"))?;
    check_sum(&data, &sums, &name).map_err(|err| format!("{name} was not installed: {err}"))?;
    let path = dir.join(&name);
    std::fs::write(&path, &data).map_err(|err| format!("cannot save {name}: {err}"))?;

    say("Installing", -1.0).await;
    run(Command::new("tar")
        .arg("-xzf")
        .arg(&path)
        .arg("-C")
        .arg(dir))?;
    let installer: PathBuf = dir
        .join(name.trim_end_matches(".tar.gz"))
        .join("install.sh");
    run(&mut Command::new(installer))
}

/// The whole body of `url`, telling `progress` how much of it came (0 to 1).
async fn download<F, Fut>(http: &reqwest::Client, url: &str, progress: F) -> Result<Vec<u8>, String>
where
    F: Fn(f64) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let resp = http.get(url).send().await.map_err(|err| err.to_string())?;
    let resp = checked(resp).map_err(|err| err.to_string())?;
    let total = resp.content_length().filter(|&n| n > 0);
    let mut data = Vec::new();
    let mut said = 0;
    let mut body = resp.bytes_stream();
    while let Some(chunk) = body.next().await {
        data.extend_from_slice(&chunk.map_err(|err| err.to_string())?);
        if let Some(total) = total {
            // Every 5 %, so the bus is not flooded.
            let percent = data.len() as u64 * 100 / total;
            if percent >= said + 5 {
                said = percent;
                progress(percent as f64 / 100.0).await;
            }
        }
    }
    Ok(data)
}

fn run(command: &mut Command) -> Result<(), String> {
    let program = command.get_program().to_string_lossy().into_owned();
    match command.status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("{program} failed ({status})")),
        Err(err) => Err(format!("cannot run {program}: {err}")),
    }
}

fn confirmed() -> bool {
    print!("Update now? [y/N] ");
    let _ = std::io::stdout().flush();
    let mut answer = String::new();
    let _ = std::io::stdin().lock().read_line(&mut answer);
    matches!(answer.trim(), "y" | "Y" | "yes")
}

fn fail(message: &str) -> ExitCode {
    eprintln!("nokta: {message}");
    ExitCode::FAILURE
}
