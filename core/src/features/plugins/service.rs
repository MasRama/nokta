//! Keeps the installed plugins: reads their folders and `plugins.toml`,
//! runs the ones that are on, and publishes their state and cards.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::sync::{mpsc, oneshot, watch};

use super::card::Card;
use super::install;
use super::manifest::{Manifest, OptionSpec, OptionValue};
use super::runner::{self, Event, Runner, Spec};
use super::saved::{self, Saved};
use super::{PluginAlert, PluginRow, PluginsState};
use crate::shared::paths::System;

pub type Reply<T> = oneshot::Sender<Result<T, String>>;

pub enum Command {
    SetEnabled {
        id: String,
        enabled: bool,
        reply: Reply<()>,
    },
    SetOption {
        id: String,
        key: String,
        value: String,
        reply: Reply<()>,
    },
    /// Runs it now, with an action from one of its buttons or none.
    Run {
        id: String,
        action: String,
        reply: Reply<()>,
    },
    /// Copies a plugin folder in; answers its id. It starts off.
    Install {
        path: PathBuf,
        reply: Reply<String>,
    },
    Remove {
        id: String,
        reply: Reply<()>,
    },
}

pub struct Handle {
    pub commands: mpsc::Sender<Command>,
    pub state: watch::Receiver<PluginsState>,
    pub alerts: mpsc::Receiver<PluginAlert>,
}

#[derive(Clone, Debug)]
pub struct Dirs {
    pub plugins_dir: PathBuf,
    pub saved_file: PathBuf,
}

#[derive(Clone, Debug, PartialEq)]
enum Status {
    Off,
    Running,
    Ok,
    Error(String),
}

struct Entry {
    dir: PathBuf,
    manifest: Result<Manifest, String>,
    runner: Option<(Runner, Spec)>,
    status: Status,
    card: Option<Card>,
    last_alert: String,
}

struct Service {
    dirs: Dirs,
    system: System,
    saved: Saved,
    entries: BTreeMap<String, Entry>,
    events: mpsc::Sender<Event>,
    state: watch::Sender<PluginsState>,
    alerts: mpsc::Sender<PluginAlert>,
}

pub fn spawn(dirs: Dirs, system: System) -> Handle {
    let (commands, requests) = mpsc::channel(16);
    let (state_tx, state) = watch::channel(PluginsState::default());
    let (alerts_tx, alerts) = mpsc::channel(16);
    tokio::spawn(run(dirs, system, requests, state_tx, alerts_tx));
    Handle {
        commands,
        state,
        alerts,
    }
}

async fn run(
    dirs: Dirs,
    system: System,
    mut requests: mpsc::Receiver<Command>,
    state: watch::Sender<PluginsState>,
    alerts: mpsc::Sender<PluginAlert>,
) {
    let (events, mut heard) = mpsc::channel(32);
    let (_watcher, mut changes) =
        match super::watch::watch(dirs.plugins_dir.clone(), dirs.saved_file.clone()) {
            Ok((watcher, changes)) => (Some(watcher), changes),
            Err(err) => {
                tracing::warn!("cannot watch {}: {err:#}", dirs.plugins_dir.display());
                (None, mpsc::channel(1).1)
            }
        };
    let mut service = Service {
        saved: saved::load(&dirs.saved_file).await,
        dirs,
        system,
        entries: BTreeMap::new(),
        events,
        state,
        alerts,
    };
    service.rescan().await;
    loop {
        tokio::select! {
            request = requests.recv() => match request {
                Some(command) => service.command(command).await,
                None => return,
            },
            Some(event) = heard.recv() => service.event(event).await,
            Some(()) = changes.recv() => {
                service.saved = saved::load(&service.dirs.saved_file).await;
                service.rescan().await;
            }
        }
    }
}

/// Every plugin folder in `dir`, by its name, with its manifest or why it is broken.
fn scan(dir: &Path) -> BTreeMap<String, (PathBuf, Result<Manifest, String>)> {
    let mut found = BTreeMap::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if name.starts_with('.') || !path.join(super::manifest::FILE).is_file() {
            continue;
        }
        let manifest = install::read_manifest(&path).and_then(|m| {
            if m.id == name {
                Ok(m)
            } else {
                Err(format!("its id is {}, but its folder is {name}", m.id))
            }
        });
        found.insert(name, (path, manifest));
    }
    found
}

fn valid_action(action: &str) -> bool {
    action.len() <= 32
        && action
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Serialize)]
struct Info<'a> {
    name: &'a str,
    description: &'a str,
    version: &'a str,
    author: &'a str,
    homepage: &'a str,
    icon: &'a str,
    every: u32,
    dir: String,
    /// Whether it has a command for this system.
    runs_here: bool,
    options: Vec<OptionInfo<'a>>,
}

#[derive(Serialize)]
struct OptionInfo<'a> {
    #[serde(flatten)]
    spec: &'a OptionSpec,
    value: OptionValue,
}

impl Service {
    async fn rescan(&mut self) {
        let dir = self.dirs.plugins_dir.clone();
        let found = tokio::task::spawn_blocking(move || scan(&dir))
            .await
            .unwrap_or_default();
        self.entries.retain(|id, _| found.contains_key(id));
        for (id, (dir, manifest)) in found {
            match self.entries.get_mut(&id) {
                Some(entry) => {
                    entry.dir = dir;
                    entry.manifest = manifest;
                }
                None => {
                    self.entries.insert(
                        id,
                        Entry {
                            dir,
                            manifest,
                            runner: None,
                            status: Status::Off,
                            card: None,
                            last_alert: String::new(),
                        },
                    );
                }
            }
        }
        self.apply();
        self.publish();
    }

    /// The process the plugin should run as now, or none while it is off.
    fn spec(&self, id: &str, entry: &Entry) -> Option<Spec> {
        let saved = self.saved.get(id)?;
        let manifest = entry.manifest.as_ref().ok()?;
        if !saved.enabled {
            return None;
        }
        let argv = manifest.argv(self.system)?.to_vec();
        let env = saved::values(manifest, Some(saved))
            .into_iter()
            .map(|(key, value)| {
                (
                    format!("NOKTA_OPTION_{}", key.to_uppercase()),
                    value.as_env(),
                )
            })
            .collect();
        Some(Spec {
            id: id.to_owned(),
            dir: entry.dir.clone(),
            argv,
            data: install::data_dir(id, &self.dirs.plugins_dir),
            every: manifest.run.every,
            timeout: manifest.run.timeout,
            env,
        })
    }

    /// Starts, stops or starts again each plugin to match what is saved.
    fn apply(&mut self) {
        let ids: Vec<String> = self.entries.keys().cloned().collect();
        for id in ids {
            let want = self.spec(&id, &self.entries[&id]);
            let entry = self.entries.get_mut(&id).expect("listed above");
            let running = entry.runner.as_ref().map(|(_, spec)| spec);
            if running == want.as_ref() {
                continue;
            }
            entry.runner = None;
            match want {
                Some(spec) => {
                    tracing::info!(plugin = %id, "starting");
                    entry.runner = Some((runner::spawn(spec.clone(), self.events.clone()), spec));
                    entry.status = Status::Running;
                }
                None => {
                    entry.status = Status::Off;
                    entry.card = None;
                }
            }
        }
    }

    fn publish(&self) {
        let mut order: Vec<(&String, &Entry)> = self.entries.iter().collect();
        order.sort_by_key(|(id, entry)| {
            let name = entry
                .manifest
                .as_ref()
                .map_or(id.as_str(), |m| m.name.as_str());
            (name.to_lowercase(), (*id).clone())
        });
        let plugins = order
            .iter()
            .map(|(id, entry)| self.row(id, entry))
            .collect();
        let cards = order
            .iter()
            .filter(|(_, entry)| entry.runner.is_some())
            .filter_map(|(id, entry)| {
                let card = entry.card.as_ref().filter(|c| c.shows())?;
                Some(((*id).clone(), card.to_json()))
            })
            .collect();
        self.state.send_if_modified(|state| {
            let next = PluginsState { plugins, cards };
            let changed = *state != next;
            *state = next;
            changed
        });
    }

    fn row(&self, id: &str, entry: &Entry) -> PluginRow {
        let enabled = self.saved.get(id).is_some_and(|s| s.enabled);
        let dir = entry.dir.to_string_lossy().into_owned();
        let (status, message, info) = match &entry.manifest {
            Err(why) => (
                "broken",
                why.clone(),
                serde_json::json!({ "name": id, "dir": dir, "runs_here": false, "options": [] })
                    .to_string(),
            ),
            Ok(manifest) => {
                let runs_here = manifest.argv(self.system).is_some();
                let info = Info {
                    name: &manifest.name,
                    description: &manifest.description,
                    version: &manifest.version,
                    author: &manifest.author,
                    homepage: &manifest.homepage,
                    icon: &manifest.icon,
                    every: manifest.run.every,
                    dir,
                    runs_here,
                    options: manifest
                        .options
                        .iter()
                        .zip(saved::values(manifest, self.saved.get(id)))
                        .map(|(spec, (_, value))| OptionInfo { spec, value })
                        .collect(),
                };
                let info = serde_json::to_string(&info).expect("info always serializes");
                match &entry.status {
                    _ if !runs_here => ("unsupported", String::new(), info),
                    Status::Off => ("off", String::new(), info),
                    Status::Running => ("running", String::new(), info),
                    Status::Ok => ("ok", String::new(), info),
                    Status::Error(message) => ("error", message.clone(), info),
                }
            }
        };
        PluginRow {
            id: id.to_owned(),
            enabled,
            status: status.to_owned(),
            message,
            info,
        }
    }

    async fn event(&mut self, event: Event) {
        let (id, result) = match event {
            Event::Card(id, card) => (id, Ok(*card)),
            Event::Failed(id, message) => (id, Err(message)),
        };
        let Some(entry) = self.entries.get_mut(&id) else {
            return;
        };
        if entry.runner.is_none() {
            return;
        }
        match result {
            Ok(mut card) => {
                entry.status = Status::Ok;
                if let Some(alert) = card.alert.take() {
                    if alert.id != entry.last_alert {
                        entry.last_alert = alert.id.clone();
                        let alert = PluginAlert {
                            id: id.clone(),
                            title: alert.title,
                            detail: alert.detail,
                            icon: if card.icon.is_empty() {
                                entry
                                    .manifest
                                    .as_ref()
                                    .map(|m| m.icon.clone())
                                    .unwrap_or_default()
                            } else {
                                card.icon.clone()
                            },
                            tone: card.tone.clone(),
                            important: alert.important,
                        };
                        let _ = self.alerts.try_send(alert);
                    }
                }
                entry.card = Some(card);
            }
            Err(message) => entry.status = Status::Error(message),
        }
        self.publish();
    }

    async fn save(&self) {
        saved::save(&self.dirs.saved_file, &self.saved).await;
    }

    async fn command(&mut self, command: Command) {
        match command {
            Command::SetEnabled { id, enabled, reply } => {
                let result = self.set_enabled(&id, enabled).await;
                let _ = reply.send(result);
            }
            Command::SetOption {
                id,
                key,
                value,
                reply,
            } => {
                let result = self.set_option(&id, &key, &value).await;
                let _ = reply.send(result);
            }
            Command::Run { id, action, reply } => {
                let result = match self.entries.get(&id).and_then(|e| e.runner.as_ref()) {
                    _ if !valid_action(&action) => Err(format!("{action:?} is not an action")),
                    Some((runner, _)) => {
                        // A full queue already holds work for it.
                        let _ = runner.actions.try_send(action);
                        Ok(())
                    }
                    None => Err(format!("{id} is not on")),
                };
                let _ = reply.send(result);
            }
            Command::Install { path, reply } => {
                let dir = self.dirs.plugins_dir.clone();
                let result = tokio::task::spawn_blocking(move || install::install(&path, &dir))
                    .await
                    .unwrap_or_else(|err| Err(err.to_string()))
                    .map(|manifest| manifest.id);
                if let Ok(id) = &result {
                    tracing::info!(plugin = %id, "installed");
                    // Running again from its new files.
                    if let Some(entry) = self.entries.get_mut(id) {
                        entry.runner = None;
                    }
                    self.rescan().await;
                }
                let _ = reply.send(result);
            }
            Command::Remove { id, reply } => {
                if let Some(entry) = self.entries.get_mut(&id) {
                    entry.runner = None;
                }
                let dir = self.dirs.plugins_dir.clone();
                let target = id.clone();
                let result = tokio::task::spawn_blocking(move || install::remove(&target, &dir))
                    .await
                    .unwrap_or_else(|err| Err(err.to_string()));
                if result.is_ok() {
                    tracing::info!(plugin = %id, "removed");
                    if self.saved.remove(&id).is_some() {
                        self.save().await;
                    }
                }
                self.rescan().await;
                let _ = reply.send(result);
            }
        }
    }

    async fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<(), String> {
        let entry = self
            .entries
            .get(id)
            .ok_or_else(|| format!("no plugin {id}"))?;
        if enabled {
            let manifest = entry.manifest.as_ref().map_err(Clone::clone)?;
            if manifest.argv(self.system).is_none() {
                return Err(format!("{} does not run on this system", manifest.name));
            }
        }
        let saved = self.saved.entry(id.to_owned()).or_default();
        if saved.enabled != enabled {
            saved.enabled = enabled;
            self.save().await;
        }
        self.apply();
        self.publish();
        Ok(())
    }

    async fn set_option(&mut self, id: &str, key: &str, value: &str) -> Result<(), String> {
        let entry = self
            .entries
            .get(id)
            .ok_or_else(|| format!("no plugin {id}"))?;
        let manifest = entry.manifest.as_ref().map_err(Clone::clone)?;
        let spec = manifest
            .options
            .iter()
            .find(|o| o.key == key)
            .ok_or_else(|| format!("{} has no option {key}", manifest.name))?;
        let value = spec.parse(value)?;
        let saved = self.saved.entry(id.to_owned()).or_default();
        if saved.options.get(key) != Some(&value) {
            saved.options.insert(key.to_owned(), value);
            self.save().await;
        }
        self.apply();
        self.publish();
        Ok(())
    }
}
