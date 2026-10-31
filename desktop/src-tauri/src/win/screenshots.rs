//! New screenshots: Windows saves them (Win+PrtScn, and the Snipping Tool
//! by default) to its Screenshots folder, which the core's download watcher
//! follows while `[behavior] screenshot_preview` is on. Each comes with a
//! thumbnail, as on GNOME the screenshot's banner does.

use std::path::Path;

use nokta_core::app::follow;
use nokta_core::features::downloads::service::{self, Finished};
use nokta_core::features::settings::{Config, DownloadsConfig};
use tokio::sync::{mpsc, watch};

/// Watches the Screenshots folder; its thumbnails go to `cache_dir`.
/// Needs Tokio.
pub fn spawn(config: watch::Receiver<Config>, cache_dir: &Path) -> mpsc::Receiver<Finished> {
    let folder = super::folders::screenshots();
    if let Some(folder) = &folder {
        // Windows makes it with the first screenshot, too late to watch.
        if let Err(err) = std::fs::create_dir_all(folder) {
            tracing::warn!("no screenshot previews: {}: {err}", folder.display());
        }
    }
    let folder = folder.map(|f| f.display().to_string());
    let watched = follow(config, move |c| DownloadsConfig {
        enabled: c.behavior.screenshot_preview && folder.is_some(),
        folder: folder.clone().unwrap_or_default(),
    });
    service::spawn(watched, None, cache_dir.join("screenshots"))
}
