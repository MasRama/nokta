//! Progress that apps report to the dock (`com.canonical.Unity.LauncherEntry`),
//! as activities: shown once visible for 1.5 s, passed on at most twice a second.

use std::collections::HashMap;

use super::desktop::App;
use super::model::Update;

/// How long progress must stay visible before it shows, so quick ones never flash.
const SHOW_AFTER_US: i64 = 1_500_000;
/// The least time between two updates of one activity.
const THROTTLE_US: i64 = 500_000;

/// What one `Update` signal says; a key it leaves out keeps its last value.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Report {
    pub progress: Option<f64>,
    pub visible: Option<bool>,
}

/// What the activities service is told.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Set(String, Update),
    End(String, bool, String),
}

struct Entry {
    sender: String,
    app: App,
    detail: &'static str,
    progress: f64,
    visible: bool,
    /// Since when the progress has been visible.
    since_us: Option<i64>,
    /// When the activity was last set; `None` while it does not show.
    sent_us: Option<i64>,
    /// Changed since it was last set.
    dirty: bool,
}

impl Entry {
    fn set(&mut self, id: &str, now_us: i64) -> Action {
        self.sent_us = Some(now_us);
        self.dirty = false;
        Action::Set(
            id.to_owned(),
            Update {
                title: self.app.name.clone(),
                detail: self.detail.to_owned(),
                icon: self.app.icon.clone(),
                progress: self.progress,
            },
        )
    }

    /// When this entry next has something to say.
    fn deadline(&self) -> Option<i64> {
        match (self.sent_us, self.since_us) {
            (Some(sent), _) if self.dirty => Some(sent + THROTTLE_US),
            (None, Some(since)) => Some(since + SHOW_AFTER_US),
            _ => None,
        }
    }

    fn due(&mut self, id: &str, now_us: i64) -> Option<Action> {
        self.deadline()
            .filter(|at| *at <= now_us)
            .map(|_| self.set(id, now_us))
    }
}

/// The apps' progress, keyed by activity id `app:<desktop id>`.
#[derive(Default)]
pub struct LauncherState {
    entries: HashMap<String, Entry>,
}

/// `firefox.desktop` from `application://firefox.desktop`.
pub fn desktop_id(app_uri: &str) -> Option<&str> {
    app_uri
        .strip_prefix("application://")
        .filter(|id| !id.is_empty())
}

/// What the app is doing, guessed from what kind of app it is.
fn detail_for(id: &str) -> &'static str {
    const BROWSERS: [&str; 8] = [
        "firefox",
        "chrom",
        "brave",
        "edge",
        "vivaldi",
        "opera",
        "epiphany",
        "librewolf",
    ];
    let id = id.to_ascii_lowercase();
    if BROWSERS.iter().any(|b| id.contains(b)) {
        "Downloading"
    } else if id.contains("nautilus") {
        "Working on files"
    } else {
        "In progress"
    }
}

impl LauncherState {
    /// An `Update(app_uri, props)` signal from `sender`; `app` looks the
    /// desktop entry up the first time the app reports.
    pub fn update(
        &mut self,
        sender: &str,
        app_uri: &str,
        report: Report,
        app: impl FnOnce(&str) -> App,
        now_us: i64,
    ) -> Vec<Action> {
        let Some(desktop) = desktop_id(app_uri) else {
            return vec![];
        };
        let id = format!("app:{desktop}");
        let entry = self.entries.entry(id.clone()).or_insert_with(|| Entry {
            sender: sender.to_owned(),
            app: app(desktop),
            detail: detail_for(desktop),
            progress: -1.0,
            visible: false,
            since_us: None,
            sent_us: None,
            dirty: false,
        });
        entry.sender = sender.to_owned();
        if let Some(p) = report.progress {
            entry.progress = if p.is_finite() {
                p.clamp(0.0, 1.0)
            } else {
                -1.0
            };
            entry.dirty = true;
        }
        if let Some(visible) = report.visible {
            entry.visible = visible;
        }
        if !entry.visible {
            let shown = entry.sent_us.is_some();
            entry.since_us = None;
            entry.sent_us = None;
            entry.dirty = false;
            return if shown {
                vec![Action::End(id, true, "Done".into())]
            } else {
                vec![]
            };
        }
        entry.since_us.get_or_insert(now_us);
        if entry.sent_us.is_some() {
            entry.dirty = true;
        }
        entry.due(&id, now_us).into_iter().collect()
    }

    /// Shows the progress that has been visible long enough, and passes on held updates.
    pub fn tick(&mut self, now_us: i64) -> Vec<Action> {
        self.entries
            .iter_mut()
            .filter_map(|(id, entry)| entry.due(id, now_us))
            .collect()
    }

    /// When `tick` next has something to do.
    pub fn next_deadline(&self) -> Option<i64> {
        self.entries.values().filter_map(Entry::deadline).min()
    }

    /// `sender` left the bus: its activities end as stopped.
    pub fn sender_gone(&mut self, sender: &str) -> Vec<Action> {
        let mut ended = Vec::new();
        self.entries.retain(|id, entry| {
            if entry.sender != sender {
                return true;
            }
            if entry.sent_us.is_some() {
                ended.push(Action::End(id.clone(), false, "Stopped".into()));
            }
            false
        });
        ended
    }
}
