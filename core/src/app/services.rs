//! The services that run on every system: settings, lyrics and the timer.
//! Media players and device alerts are system sources; the platform part of
//! `app` starts them and hands the media state in.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, watch};

use super::USER_AGENT;
use crate::features::lyrics::{self, cache::Cache, lrclib, LyricsState};
use crate::features::media::MediaState;
use crate::features::settings::{self, Config, Store};
use crate::features::timer::logic::{Phase, Snapshot};
use crate::features::timer::{self, service::Command};
use crate::shared::paths::Paths;

pub struct Services {
    pub config: watch::Receiver<Config>,
    pub config_file: PathBuf,
    pub lyrics: watch::Receiver<LyricsState>,
    pub timer: Timer,
    /// Watches config.toml as long as the services live.
    _config_watcher: Option<notify::RecommendedWatcher>,
}

/// The timer's commands, its published state and the phases that finished.
pub struct Timer {
    pub commands: mpsc::Sender<Command>,
    pub state: watch::Receiver<Snapshot>,
    pub finished: mpsc::Receiver<Phase>,
}

impl Services {
    /// Starts the services; must run inside a Tokio runtime.
    pub fn start(
        paths: &Paths,
        media: watch::Receiver<MediaState>,
        lrclib_base_url: &str,
    ) -> Services {
        let store = Store::load_or_init(&paths.config_file);
        let (config_watcher, changes) = match settings::watch(paths.config_file.clone()) {
            Ok((watcher, changes)) => (Some(watcher), changes),
            Err(err) => {
                tracing::warn!("cannot watch {}: {err:#}", paths.config_file.display());
                (None, mpsc::channel(1).1)
            }
        };
        let config = settings::service::spawn(store, changes);

        let lyrics = lyrics::service::spawn(
            media,
            lyrics_enabled(config.clone()),
            Cache::new(paths.cache_dir.join("lyrics")),
            Arc::new(lrclib::Client::new(lrclib_base_url, USER_AGENT)),
        );

        let (commands, state, finished) = timer::service::spawn(phase_length(config.clone()));

        Services {
            config,
            config_file: paths.config_file.clone(),
            lyrics,
            timer: Timer {
                commands,
                state,
                finished,
            },
            _config_watcher: config_watcher,
        }
    }
}

/// A timer phase's length from the current `[timer]` table.
fn phase_length(
    config: watch::Receiver<Config>,
) -> impl Fn(Phase) -> Duration + Send + Sync + 'static {
    move |phase| {
        let timer = &config.borrow().timer;
        let minutes = match phase {
            Phase::Focus => timer.focus_minutes,
            Phase::Break => timer.break_minutes,
        };
        Duration::from_secs(u64::from(minutes) * 60)
    }
}

/// Follows `lyrics.enabled` from the config.
fn lyrics_enabled(mut config: watch::Receiver<Config>) -> watch::Receiver<bool> {
    let (tx, rx) = watch::channel(config.borrow().lyrics.enabled);
    tokio::spawn(async move {
        while config.changed().await.is_ok() {
            let enabled = config.borrow_and_update().lyrics.enabled;
            tx.send_if_modified(|current| std::mem::replace(current, enabled) != enabled);
        }
    });
    rx
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::sync::watch;

    use super::*;
    use crate::features::lyrics::Status;
    use crate::features::media::MediaState;
    use crate::features::timer::logic::{Phase, State};
    use crate::features::timer::service::Command;
    use crate::shared::paths::Paths;

    #[tokio::test]
    async fn start_without_a_bus() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(&dir.path().join("config"), &dir.path().join("cache"));
        let (_media, media) = watch::channel(MediaState::default());
        let mut services = Services::start(&paths, media, "http://127.0.0.1:9");

        assert!(paths.config_file.exists(), "the default config is written");
        assert_eq!(services.config.borrow().timer.focus_minutes, 25);
        assert_eq!(services.lyrics.borrow().status, Status::None);

        services
            .timer
            .commands
            .send(Command::Start(Phase::Focus))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), services.timer.state.changed())
            .await
            .unwrap()
            .unwrap();
        let timer = services.timer.state.borrow().clone();
        assert_eq!(timer.state, State::Running);
        assert_eq!(timer.duration_us, 25 * 60 * 1_000_000);
    }
}
