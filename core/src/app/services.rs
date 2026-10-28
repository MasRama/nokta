//! The services that run on every system: settings, lyrics, the timer, live
//! activities and the weather.
//! Media players and device alerts are system sources; the platform part of
//! `app` starts them and hands the media state in.

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, watch};

use super::{OpenMeteoUrls, USER_AGENT};
use crate::features::activities;
use crate::features::lyrics::{self, cache::Cache, lrclib, LyricsState};
use crate::features::media::MediaState;
use crate::features::settings::{self, Config, Store};
use crate::features::timer::logic::{Lengths, Phase, Snapshot};
use crate::features::timer::{self, service::Command};
use crate::features::weather::{self, openmeteo};
use crate::shared::clock::monotonic_us;
use crate::shared::paths::Paths;

pub struct Services {
    pub config: watch::Receiver<Config>,
    pub config_file: PathBuf,
    pub lyrics: watch::Receiver<LyricsState>,
    pub timer: Timer,
    pub activities: activities::service::Handle,
    pub weather: weather::service::Handle,
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
        open_meteo: &OpenMeteoUrls,
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
            paths.lyrics_dir.clone(),
        );

        let (commands, state, finished) = timer::service::spawn(timer_lengths(config.clone()));
        let activities = activities::service::spawn(stale_us(config.clone()));
        let weather = weather::service::spawn(
            follow(config.clone(), |c| c.weather.clone()),
            Arc::new(openmeteo::Client::new(
                &open_meteo.forecast,
                &open_meteo.geocoding,
                USER_AGENT,
            )),
            monotonic_us,
        );

        Services {
            config,
            config_file: paths.config_file.clone(),
            lyrics,
            timer: Timer {
                commands,
                state,
                finished,
            },
            activities,
            weather,
            _config_watcher: config_watcher,
        }
    }
}

/// The timer's phase lengths from the current `[timer]` table.
fn timer_lengths(config: watch::Receiver<Config>) -> impl Fn() -> Lengths + Send + Sync + 'static {
    const MINUTE_US: i64 = 60_000_000;
    move || {
        let timer = &config.borrow().timer;
        Lengths {
            focus_us: i64::from(timer.focus_minutes) * MINUTE_US,
            break_us: i64::from(timer.break_minutes) * MINUTE_US,
            long_break_us: i64::from(timer.long_break_minutes) * MINUTE_US,
            sessions_before_long_break: timer.sessions_before_long_break,
        }
    }
}

/// How long an activity may go without an update, from `[activities]`.
fn stale_us(config: watch::Receiver<Config>) -> impl Fn() -> i64 + Send + Sync + 'static {
    move || i64::from(config.borrow().activities.stale_minutes) * 60_000_000
}

/// Follows `lyrics.enabled` from the config.
fn lyrics_enabled(config: watch::Receiver<Config>) -> watch::Receiver<bool> {
    follow(config, |c| c.lyrics.enabled)
}

/// Follows one part of the config, changing only when that part does.
fn follow<T: PartialEq + Send + Sync + 'static>(
    mut config: watch::Receiver<Config>,
    part: impl Fn(&Config) -> T + Send + 'static,
) -> watch::Receiver<T> {
    let (tx, rx) = watch::channel(part(&config.borrow()));
    tokio::spawn(async move {
        while config.changed().await.is_ok() {
            let next = part(&config.borrow_and_update());
            tx.send_if_modified(|current| {
                let changed = *current != next;
                if changed {
                    *current = next;
                }
                changed
            });
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
        let paths = Paths::new(
            &dir.path().join("config"),
            &dir.path().join("cache"),
            &dir.path().join("data"),
        );
        let (_media, media) = watch::channel(MediaState::default());
        let unreachable = OpenMeteoUrls {
            forecast: "http://127.0.0.1:9".into(),
            geocoding: "http://127.0.0.1:9".into(),
        };
        let mut services = Services::start(&paths, media, "http://127.0.0.1:9", &unreachable);

        assert!(paths.config_file.exists(), "the default config is written");
        assert_eq!(services.config.borrow().timer.focus_minutes, 25);
        assert_eq!(services.lyrics.borrow().status, Status::None);
        assert_eq!(
            services.weather.state.borrow().status,
            weather::Status::Off,
            "no location, no weather"
        );

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
