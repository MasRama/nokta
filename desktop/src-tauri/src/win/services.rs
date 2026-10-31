//! The core's services, started in the app's own Tokio runtime, and what
//! the page reaches of them: an interface's properties (`bridge_props`),
//! their changes (the `nokta://props` event) and its methods
//! (`bridge_call`), named as in `contracts/*.xml`.

use std::sync::{Arc, Mutex, OnceLock};

use nokta_core::app::{follow, OpenMeteoUrls, Services, DEFAULT_LRCLIB_URL, USER_AGENT};
use nokta_core::features::activities::model::Activity;
use nokta_core::features::devices;
use nokta_core::features::downloads::service::Finished;
use nokta_core::features::lyrics::{self, LyricsState};
use nokta_core::features::media::art::ArtCache;
use nokta_core::features::media::{gsmtc, loopback, MediaState};
use nokta_core::features::settings::picture::Prepared;
use nokta_core::features::settings::{Config, Writer};
use nokta_core::features::shelf::{self, model::Item, service::Thumbnails};
use nokta_core::features::system::{self, model::Usage};
use nokta_core::features::timer::clocks::Kind;
use nokta_core::features::timer::logic::Snapshot;
use nokta_core::features::timer::service::{ClockCommand, ClocksSnapshot, Command};
use nokta_core::features::updates::{self, github, UpdateState};
use nokta_core::features::weather::WeatherState;
use nokta_core::shared::clock::{monotonic_us, wall_us};
use nokta_core::shared::http;
use nokta_core::shared::paths::Paths;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tokio::sync::{mpsc, oneshot, watch};

use crate::bridge::{
    activities as activities_props, devices as devices_bridge, downloads as downloads_bridge,
    lyrics as lyrics_props, media, nokta, osd as osd_bridge, privacy as privacy_props, settings,
    shelf as shelf_bridge, system as system_props, timer as timer_props, toggles as toggles_props,
    updates as updates_props, weather as weather_props, Props,
};
use crate::files::KnownFiles;
use crate::layout::{self, NotchSizes};
use crate::privacy::PrivacyState;

/// The event that carries an interface's changed properties to every page.
pub const PROPS_EVENT: &str = "nokta://props";

/// The event that carries an interface's signals to every page.
pub const SIGNAL_EVENT: &str = "nokta://signal";

/// The clocks' commands, for the system waking from sleep.
static CLOCKS: OnceLock<mpsc::Sender<ClockCommand>> = OnceLock::new();

/// Counts the system's wakes from sleep, for the update check.
static RESUMES: OnceLock<watch::Sender<u64>> = OnceLock::new();

/// The system counters' watches, for a notch window that closes.
static SYSTEM: OnceLock<mpsc::Sender<system::service::Command>> = OnceLock::new();

#[derive(Clone, serde::Serialize)]
struct Signal {
    interface: &'static str,
    signal: &'static str,
    args: Vec<serde_json::Value>,
}

#[derive(Clone, serde::Serialize)]
struct Changed {
    interface: &'static str,
    props: Props,
}

pub struct Core {
    config: watch::Receiver<Config>,
    picture: watch::Receiver<Prepared>,
    writer: Writer,
    media: watch::Receiver<MediaState>,
    player: gsmtc::Controller,
    lyrics: watch::Receiver<LyricsState>,
    lyrics_commands: mpsc::Sender<lyrics::service::Command>,
    privacy: watch::Receiver<PrivacyState>,
    weather: watch::Receiver<WeatherState>,
    weather_refresh: mpsc::Sender<()>,
    toggles: super::toggles::Toggles,
    timer: watch::Receiver<Snapshot>,
    timer_commands: mpsc::Sender<Command>,
    clocks: watch::Receiver<ClocksSnapshot>,
    clock_commands: mpsc::Sender<ClockCommand>,
    activities: watch::Receiver<Vec<Activity>>,
    updates: watch::Receiver<UpdateState>,
    update_commands: mpsc::Sender<updates::service::Command>,
    usage: watch::Receiver<Usage>,
    system_commands: mpsc::Sender<system::service::Command>,
    shelf: watch::Receiver<Vec<Item>>,
    shelf_thumbnails: watch::Receiver<Thumbnails>,
    shelf_commands: mpsc::Sender<shelf::service::Command>,
    /// The files the page may open.
    known: Arc<Mutex<KnownFiles>>,
    /// Keeps the services and their watchers alive.
    _services: Mutex<Services>,
}

impl Core {
    /// The config as it is now.
    pub fn config(&self) -> Config {
        self.config.borrow().clone()
    }

    /// The path of a file the core announced, else None.
    pub fn file_path(&self, uri: &str) -> Option<std::path::PathBuf> {
        self.known
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .path(uri)
    }

    /// Takes files an app took from the shelf off it.
    pub fn taken(&self, uris: Vec<String>) {
        for uri in uris {
            if let Err(err) = self
                .shelf_commands
                .try_send(shelf::service::Command::Remove(uri))
            {
                tracing::warn!("cannot take a dragged file off the shelf: {err}");
            }
        }
    }

    /// Puts files dropped on the notch on the shelf.
    pub fn keep(&self, uris: Vec<String>) {
        if uris.is_empty() {
            return;
        }
        // A full queue loses the drop; the shelf is stuck.
        if let Err(err) = self
            .shelf_commands
            .try_send(shelf::service::Command::Add(uris))
        {
            tracing::warn!("cannot keep the dropped files: {err}");
        }
    }
}

/// Starts the services and the forwarders; the app manages the result.
pub fn start(app: &AppHandle, paths: &Paths) -> Core {
    let http = http::client(|b| b.user_agent(USER_AGENT));
    let (media_state, player, mut services, levels, alerts) =
        tauri::async_runtime::block_on(async {
            let art = ArtCache::new(paths.cache_dir.clone(), http);
            let (media_state, player) = gsmtc::spawn(art, tokio::runtime::Handle::current());
            let services = Services::start(
                paths,
                media_state.clone(),
                DEFAULT_LRCLIB_URL,
                &OpenMeteoUrls::default(),
            );
            // Records only with `[media] real_equalizer` on and music playing.
            let levels = loopback::spawn(media_state.clone(), services.config.clone(), |c| {
                c.media.real_equalizer
            });
            (
                media_state,
                player,
                services,
                levels,
                devices::watcher::spawn(),
            )
        });
    forward_settings(
        app.clone(),
        services.config.clone(),
        services.picture.clone(),
    );
    forward(app.clone(), media_state.clone(), media::INTERFACE, |s| {
        media::props(s, monotonic_us(), wall_us())
    });
    forward_signal(
        app.clone(),
        levels,
        To::Every,
        media::INTERFACE,
        "Levels",
        |levels| vec![serde_json::json!(levels)],
    );
    forward_signal(
        app.clone(),
        alerts,
        To::Front,
        devices_bridge::INTERFACE,
        devices_bridge::ALERT,
        devices_bridge::alert_args,
    );
    forward_signal(
        app.clone(),
        super::osd::spawn(),
        To::Front,
        osd_bridge::INTERFACE,
        osd_bridge::SHOW,
        osd_bridge::show_args,
    );
    forward(
        app.clone(),
        services.lyrics.state.clone(),
        lyrics_props::INTERFACE,
        lyrics_props::props,
    );
    super::shortcut::follow(
        services.config.clone(),
        (
            services.timer.state.clone(),
            services.timer.commands.clone(),
        ),
    );
    forward(
        app.clone(),
        services.timer.state.clone(),
        timer_props::INTERFACE,
        |s| timer_props::props(s, monotonic_us(), wall_us()),
    );
    forward(
        app.clone(),
        services.timer.clocks.state.clone(),
        timer_props::INTERFACE,
        |s| timer_props::clock_props(s, monotonic_us(), wall_us()),
    );
    // The services keep their own end; the signals go to the page.
    let finished = std::mem::replace(&mut services.timer.finished, mpsc::channel(1).1);
    forward_signal(
        app.clone(),
        sounded(finished, services.config.clone(), |_| super::sound::DONE),
        To::Front,
        timer_props::INTERFACE,
        timer_props::FINISHED,
        timer_props::finished_args,
    );
    let done = std::mem::replace(&mut services.timer.clocks.done, mpsc::channel(1).1);
    forward_signal(
        app.clone(),
        sounded(done, services.config.clone(), |done| match done.kind {
            Kind::Alarm => super::sound::ALARM,
            Kind::Countdown | Kind::Stopwatch => super::sound::COUNTDOWN,
        }),
        To::Front,
        timer_props::INTERFACE,
        timer_props::CLOCK_DONE,
        timer_props::clock_done_args,
    );
    let _ = CLOCKS.set(services.timer.clocks.commands.clone());
    let privacy = super::privacy::spawn();
    forward(
        app.clone(),
        privacy.clone(),
        privacy_props::INTERFACE,
        privacy_props::props,
    );
    forward(
        app.clone(),
        services.weather.state.clone(),
        weather_props::INTERFACE,
        weather_props::props,
    );
    let toggles = super::toggles::spawn();
    forward(
        app.clone(),
        toggles.state.clone(),
        toggles_props::INTERFACE,
        toggles_props::props,
    );
    forward(
        app.clone(),
        services.activities.state.clone(),
        activities_props::INTERFACE,
        |list| activities_props::props(list, monotonic_us(), wall_us()),
    );
    let ended = std::mem::replace(&mut services.activities.ended, mpsc::channel(1).1);
    forward_signal(
        app.clone(),
        ended,
        To::Front,
        activities_props::INTERFACE,
        activities_props::ENDED,
        activities_props::ended_args,
    );
    let (resumed, resumes) = watch::channel(0);
    let _ = RESUMES.set(resumed);
    let releases = tauri::async_runtime::block_on(async {
        updates::service::spawn(
            follow(services.config.clone(), |c| c.updates.clone()),
            Arc::new(github::Client::new(github::DEFAULT_API_URL, USER_AGENT)),
            env!("CARGO_PKG_VERSION"),
            resumes,
            wall_us,
        )
    });
    forward(
        app.clone(),
        releases.state.clone(),
        updates_props::INTERFACE,
        updates_props::props,
    );
    let mut counters = tauri::async_runtime::block_on(async {
        system::service::spawn(
            Arc::new(system::win::Win::new()),
            follow(services.config.clone(), |c| c.system.clone()),
            system::win::pressure(),
        )
    });
    forward(
        app.clone(),
        counters.usage.clone(),
        system_props::INTERFACE,
        system_props::props,
    );
    let memory_low = std::mem::replace(&mut counters.memory_low, mpsc::channel(1).1);
    forward_signal(
        app.clone(),
        memory_low,
        To::Front,
        system_props::INTERFACE,
        system_props::MEMORY_LOW,
        system_props::memory_low_args,
    );
    let _ = SYSTEM.set(counters.commands.clone());
    let known = Arc::new(Mutex::new(KnownFiles::default()));
    let downloads = std::mem::replace(&mut services.downloads, mpsc::channel(1).1);
    forward_signal(
        app.clone(),
        remembered(downloads, known.clone()),
        To::Front,
        downloads_bridge::INTERFACE,
        downloads_bridge::FINISHED,
        downloads_bridge::finished_args,
    );
    forward(
        app.clone(),
        services.shelf.state.clone(),
        shelf_bridge::INTERFACE,
        |items| shelf_bridge::items_props(items),
    );
    forward(
        app.clone(),
        services.shelf.thumbnails.clone(),
        shelf_bridge::INTERFACE,
        shelf_bridge::thumbnails_props,
    );
    follow_shelf(services.shelf.state.clone(), known.clone());
    Core {
        config: services.config.clone(),
        picture: services.picture.clone(),
        writer: Writer::new(services.config_file.clone()),
        media: media_state,
        player,
        lyrics: services.lyrics.state.clone(),
        lyrics_commands: services.lyrics.commands.clone(),
        privacy,
        weather: services.weather.state.clone(),
        weather_refresh: services.weather.refresh.clone(),
        toggles,
        timer: services.timer.state.clone(),
        timer_commands: services.timer.commands.clone(),
        clocks: services.timer.clocks.state.clone(),
        clock_commands: services.timer.clocks.commands.clone(),
        activities: services.activities.state.clone(),
        updates: releases.state,
        update_commands: releases.commands,
        usage: counters.usage,
        system_commands: counters.commands,
        shelf: services.shelf.state.clone(),
        shelf_thumbnails: services.shelf.thumbnails.clone(),
        shelf_commands: services.shelf.commands.clone(),
        known,
        _services: Mutex::new(services),
    }
}

/// The system woke from sleep: the clocks read the wall clock again, and
/// an update check that came due while asleep runs, as noktad does on
/// logind's PrepareForSleep.
pub fn woke() {
    if let Some(clocks) = CLOCKS.get() {
        let _ = clocks.try_send(ClockCommand::Wake);
    }
    if let Some(resumes) = RESUMES.get() {
        resumes.send_modify(|count| *count += 1);
    }
}

/// A notch window closed: its watches of the system counters end, as a
/// D-Bus caller's do when it leaves the bus.
pub fn forget(label: &str) {
    if let Some(system) = SYSTEM.get() {
        let _ = system.try_send(system::service::Command::Gone(label.to_owned()));
    }
}

/// Remembers each finished download, so the page may open it, and passes
/// it on.
fn remembered(
    mut downloads: mpsc::Receiver<Finished>,
    known: Arc<Mutex<KnownFiles>>,
) -> mpsc::Receiver<Finished> {
    let (tx, rx) = mpsc::channel(8);
    tauri::async_runtime::spawn(async move {
        while let Some(file) = downloads.recv().await {
            known
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .add_download(&file.uri);
            if tx.send(file).await.is_err() {
                break;
            }
        }
    });
    rx
}

/// Lets the page open and drag out what is on the shelf, while it is there.
fn follow_shelf(mut items: watch::Receiver<Vec<Item>>, known: Arc<Mutex<KnownFiles>>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let uris = items
                .borrow_and_update()
                .iter()
                .map(|item| item.uri.clone())
                .collect();
            known
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .set_shelf(uris);
            if items.changed().await.is_err() {
                break;
            }
        }
    });
}

/// Plays `sound`'s for each of `items` while `[timer] sound` is on, and
/// passes them on.
fn sounded<T: Send + 'static>(
    mut items: mpsc::Receiver<T>,
    config: watch::Receiver<Config>,
    sound: fn(&T) -> &'static str,
) -> mpsc::Receiver<T> {
    let (tx, rx) = mpsc::channel(16);
    tauri::async_runtime::spawn(async move {
        while let Some(item) = items.recv().await {
            if config.borrow().timer.sound {
                super::sound::play(sound(&item));
            }
            if tx.send(item).await.is_err() {
                break;
            }
        }
    });
    rx
}

/// Sends Settings1 again on each change of the config or the picture, and
/// fits the notch windows to new sizes.
fn forward_settings(
    app: AppHandle,
    mut config: watch::Receiver<Config>,
    mut picture: watch::Receiver<Prepared>,
) {
    tauri::async_runtime::spawn(async move {
        let mut sizes = NotchSizes::from(&config.borrow().appearance);
        loop {
            tokio::select! {
                changed = config.changed() => if changed.is_err() { break },
                changed = picture.changed() => if changed.is_err() { break },
            }
            let (props, next) = {
                let config = config.borrow_and_update();
                let props = settings::props(&config, &picture.borrow_and_update());
                (props, NotchSizes::from(&config.appearance))
            };
            if next != sizes {
                sizes = next;
                super::monitors::resize(layout::window_logical_size(&sizes));
            }
            let _ = app.emit(
                PROPS_EVENT,
                Changed {
                    interface: settings::INTERFACE,
                    props,
                },
            );
        }
    });
}

/// Sends an interface's properties again on each change of `state`.
fn forward<T: Send + Sync + 'static>(
    app: AppHandle,
    mut state: watch::Receiver<T>,
    interface: &'static str,
    props: impl Fn(&T) -> Props + Send + 'static,
) {
    tauri::async_runtime::spawn(async move {
        while state.changed().await.is_ok() {
            let props = props(&state.borrow_and_update());
            let _ = app.emit(PROPS_EVENT, Changed { interface, props });
        }
    });
}

/// Which notch windows hear a signal.
#[derive(Clone, Copy)]
enum To {
    Every,
    /// The one on the monitor in use, as the extension shows an alert.
    Front,
}

/// Sends each of `items` as `interface`'s `signal`, as noktad's signals.
fn forward_signal<T: Send + 'static>(
    app: AppHandle,
    mut items: mpsc::Receiver<T>,
    to: To,
    interface: &'static str,
    signal: &'static str,
    args: impl Fn(&T) -> Vec<Value> + Send + 'static,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(item) = items.recv().await {
            let payload = Signal {
                interface,
                signal,
                args: args(&item),
            };
            let front = match to {
                To::Every => None,
                To::Front => super::monitors::notch_in_front(&app),
            };
            let _ = match front {
                Some(label) => app.emit_to(label.as_str(), SIGNAL_EVENT, payload),
                None => app.emit(SIGNAL_EVENT, payload),
            };
        }
    });
}

/// An interface's properties as they are now.
#[tauri::command]
pub fn bridge_props(core: State<'_, Core>, interface: String) -> Result<Props, String> {
    match interface.as_str() {
        nokta::INTERFACE => Ok(nokta::props()),
        media::INTERFACE => Ok(media::props(
            &core.media.borrow(),
            monotonic_us(),
            wall_us(),
        )),
        lyrics_props::INTERFACE => Ok(lyrics_props::props(&core.lyrics.borrow())),
        privacy_props::INTERFACE => Ok(privacy_props::props(&core.privacy.borrow())),
        weather_props::INTERFACE => Ok(weather_props::props(&core.weather.borrow())),
        toggles_props::INTERFACE => Ok(toggles_props::props(&core.toggles.state.borrow())),
        activities_props::INTERFACE => Ok(activities_props::props(
            &core.activities.borrow(),
            monotonic_us(),
            wall_us(),
        )),
        updates_props::INTERFACE => Ok(updates_props::props(&core.updates.borrow())),
        system_props::INTERFACE => Ok(system_props::props(&core.usage.borrow())),
        shelf_bridge::INTERFACE => Ok(shelf_bridge::props(
            &core.shelf.borrow(),
            &core.shelf_thumbnails.borrow(),
        )),
        timer_props::INTERFACE => {
            let (mono, wall) = (monotonic_us(), wall_us());
            let mut props = timer_props::props(&core.timer.borrow(), mono, wall);
            props.extend(timer_props::clock_props(&core.clocks.borrow(), mono, wall));
            Ok(props)
        }
        settings::INTERFACE => Ok(settings::props(
            &core.config.borrow(),
            &core.picture.borrow(),
        )),
        other => Err(format!("no interface {other}")),
    }
}

/// Calls `interface.method(args)`; `window` is the caller, as a D-Bus
/// sender.
#[tauri::command]
pub async fn bridge_call(
    window: WebviewWindow,
    core: State<'_, Core>,
    interface: String,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    match (interface.as_str(), method.as_str(), args.as_slice()) {
        ("Settings1", "Set", [Value::String(table), Value::String(key), value]) => {
            let value = settings::setting_value(value)
                .ok_or_else(|| format!("{table}.{key} cannot be {value}"))?;
            core.writer
                .set(table, key, &value)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        ("Settings1", "Reset", []) => {
            core.writer.reset().await.map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        (media::INTERFACE, method, args) => {
            core.player.send(media::command(method, args)?);
            Ok(Value::Null)
        }
        (lyrics_props::INTERFACE, "SetOffset", [offset]) => {
            let offset = offset.as_f64().ok_or("the offset must be a number")?;
            let (done, answer) = oneshot::channel();
            let stopped = || "the lyrics service has stopped".to_owned();
            core.lyrics_commands
                .send(lyrics::service::Command::SetOffset(
                    offset.round() as i64,
                    done,
                ))
                .await
                .map_err(|_| stopped())?;
            match answer.await.map_err(|_| stopped())? {
                Ok(_) => Ok(Value::Null),
                Err(_) => Err("no track to set the lyric timing for".into()),
            }
        }
        (weather_props::INTERFACE, "Refresh", []) => {
            // A full queue already holds a refresh.
            let _ = core.weather_refresh.try_send(());
            Ok(Value::Null)
        }
        (toggles_props::INTERFACE, "Set", [Value::String(name), Value::Bool(on)]) => {
            if core.toggles.set(name, *on) {
                Ok(Value::Null)
            } else {
                Err(format!("Windows has no toggle {name}"))
            }
        }
        (timer_props::INTERFACE, method, args) => timer_call(&core, method, args).await,
        (updates_props::INTERFACE, "Check", []) => {
            // A full queue already holds a check.
            let _ = core
                .update_commands
                .try_send(updates::service::Command::Check);
            Ok(Value::Null)
        }
        (system_props::INTERFACE, "Watch" | "Unwatch", []) => {
            let label = window.label().to_owned();
            let command = if method == "Watch" {
                system::service::Command::Watch(label)
            } else {
                system::service::Command::Unwatch(label)
            };
            core.system_commands
                .send(command)
                .await
                .map_err(|_| "the system counters have stopped".to_owned())?;
            Ok(Value::Null)
        }
        (shelf_bridge::INTERFACE, method, args) => shelf_call(&core, method, args).await,
        (privacy_props::INTERFACE, "ToggleMute", []) => {
            super::privacy::toggle_mute();
            Ok(Value::Null)
        }
        _ => Err(format!(
            "no method {interface}.{method} for {} arguments",
            args.len()
        )),
    }
}

/// Calls `Shelf1.method(args)`. The page may keep only files the core
/// told it about, like a finished download; drops come from Windows.
async fn shelf_call(core: &Core, method: &str, args: &[Value]) -> Result<Value, String> {
    let command = match (method, args) {
        ("Add", [uris]) => {
            let uris = shelf_bridge::uris(uris).ok_or("Add takes a list of URIs")?;
            if let Some(unknown) = uris.iter().find(|uri| core.file_path(uri).is_none()) {
                return Err(format!("Nokta does not keep {unknown}"));
            }
            shelf::service::Command::Add(uris)
        }
        ("Remove", [Value::String(uri)]) => shelf::service::Command::Remove(uri.clone()),
        ("Clear", []) => shelf::service::Command::Clear,
        _ => {
            return Err(format!(
                "no method Shelf1.{method} for {} arguments",
                args.len()
            ))
        }
    };
    core.shelf_commands
        .send(command)
        .await
        .map_err(|_| "the shelf has stopped".to_owned())?;
    Ok(Value::Null)
}

/// Calls `Timer1.method(args)`; an Add answers with the new clock's id.
async fn timer_call(core: &Core, method: &str, args: &[Value]) -> Result<Value, String> {
    use timer_props::Call;

    // A closure cannot take both kinds of send error.
    fn stopped<E>(_: E) -> String {
        "the timer has stopped".to_owned()
    }
    let (reply, answer) = oneshot::channel();
    let command = match timer_props::call(method, args)? {
        Call::Timer(command) => {
            core.timer_commands.send(command).await.map_err(stopped)?;
            return Ok(Value::Null);
        }
        Call::AddCountdown { label, duration_us } => ClockCommand::AddCountdown {
            label,
            duration_us,
            reply,
        },
        Call::AddStopwatch { label } => ClockCommand::AddStopwatch { label, reply },
        Call::AddAlarm { label, unix_us } => ClockCommand::AddAlarm {
            label,
            unix_us,
            reply,
        },
        Call::PauseClock(id) => ClockCommand::Pause(id),
        Call::ResumeClock(id) => ClockCommand::Resume(id),
        Call::RemoveClock(id) => ClockCommand::Remove(id),
        Call::ClearClocks => ClockCommand::Clear,
    };
    let adds = matches!(
        command,
        ClockCommand::AddCountdown { .. }
            | ClockCommand::AddStopwatch { .. }
            | ClockCommand::AddAlarm { .. }
    );
    core.clock_commands.send(command).await.map_err(stopped)?;
    if !adds {
        return Ok(Value::Null);
    }
    let id = answer
        .await
        .map_err(|_| "the clocks have stopped".to_owned())?
        .map_err(|err| err.to_string())?;
    Ok(Value::String(id))
}
