//! System updates and installs that PackageKit runs, as activities. The
//! numbers are PackageKit's enums (`pk-enum.h`).

use std::collections::HashMap;

use super::launcher::Action;
use super::model::Update;

/// `TransactionFlags` bits of transactions that change nothing on the system.
const SIMULATE: u64 = 1 << 2;
const ONLY_DOWNLOAD: u64 = 1 << 3;
/// `Percentage` when PackageKit does not know it.
const UNKNOWN_PERCENTAGE: u32 = 101;

/// What one `PropertiesChanged` or `GetAll` says; a property it leaves out
/// keeps its last value.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Props {
    pub role: Option<u32>,
    pub status: Option<u32>,
    pub percentage: Option<u32>,
    pub flags: Option<u64>,
}

/// The activity's title for a role; `None` for roles the notch leaves out.
pub fn title(role: u32) -> Option<&'static str> {
    match role {
        10 | 11 => Some("Installing software"),
        14 => Some("Removing software"),
        22 => Some("Installing updates"),
        33 => Some("Upgrading the system"),
        _ => None,
    }
}

fn icon(role: u32) -> &'static str {
    match role {
        22 | 33 => "software-update-available-symbolic",
        _ => "system-software-install-symbolic",
    }
}

/// What a transaction in `status` is doing.
pub fn detail(status: u32) -> &'static str {
    match status {
        8 | 20..=25 => "Downloading",
        9 => "Installing",
        10 => "Updating",
        6 | 12 => "Removing",
        11 => "Cleaning up",
        13 => "Resolving dependencies",
        14 => "Checking signatures",
        15 => "Testing changes",
        16 => "Applying changes",
        19 => "Cancelling",
        1 | 30 => "Waiting",
        31 => "Waiting for authorization",
        _ => "Preparing",
    }
}

/// 0 to 1, or -1 when unknown.
pub fn progress(percentage: u32) -> f64 {
    if percentage >= UNKNOWN_PERCENTAGE {
        -1.0
    } else {
        f64::from(percentage) / 100.0
    }
}

/// Simulations and download-only runs change nothing worth showing.
pub fn skipped(flags: u64) -> bool {
    flags & (SIMULATE | ONLY_DOWNLOAD) != 0
}

/// Whether a `Finished(exit, ...)` succeeded, and what the notch says.
pub fn outcome(exit: u32) -> (bool, &'static str) {
    match exit {
        1 => (true, "Done"),
        3 | 6 | 9 => (false, "Cancelled"),
        _ => (false, "Failed"),
    }
}

#[derive(Default)]
struct Transaction {
    props: Props,
    /// What the activity last showed; `None` while it does not show.
    sent: Option<Update>,
    /// Finished, and kept until it leaves the list so a late change cannot show it again.
    finished: bool,
}

impl Transaction {
    /// The activity this transaction shows, once its role and flags are known.
    fn update(&self) -> Option<Update> {
        let p = &self.props;
        let role = p.role?;
        if skipped(p.flags?) {
            return None;
        }
        Some(Update {
            title: title(role)?.to_owned(),
            detail: detail(p.status.unwrap_or(0)).to_owned(),
            icon: icon(role).to_owned(),
            progress: p.percentage.map_or(-1.0, progress),
        })
    }
}

/// PackageKit's transactions, keyed by object path.
#[derive(Default)]
pub struct PackageKitState {
    transactions: HashMap<String, Transaction>,
}

fn activity_id(path: &str) -> String {
    format!("packagekit:{path}")
}

impl PackageKitState {
    pub fn knows(&self, path: &str) -> bool {
        self.transactions.contains_key(path)
    }

    /// New values for the transaction at `path`.
    pub fn changed(&mut self, path: &str, props: Props) -> Vec<Action> {
        let t = self.transactions.entry(path.to_owned()).or_default();
        if t.finished {
            return vec![];
        }
        let p = &mut t.props;
        p.role = props.role.or(p.role);
        p.status = props.status.or(p.status);
        p.percentage = props.percentage.or(p.percentage);
        p.flags = props.flags.or(p.flags);
        let Some(update) = t.update() else {
            return vec![];
        };
        if t.sent.as_ref() == Some(&update) {
            return vec![];
        }
        t.sent = Some(update.clone());
        vec![Action::Set(activity_id(path), update)]
    }

    /// `Finished(exit, runtime)` from the transaction at `path`.
    pub fn finished(&mut self, path: &str, exit: u32) -> Vec<Action> {
        let t = self.transactions.entry(path.to_owned()).or_default();
        t.finished = true;
        if t.sent.take().is_none() {
            return vec![];
        }
        let (success, message) = outcome(exit);
        vec![Action::End(activity_id(path), success, message.into())]
    }

    /// `TransactionListChanged`: transactions left out are gone, those shown end as stopped.
    pub fn listed(&mut self, paths: &[String]) -> Vec<Action> {
        self.end_where(|path| !paths.iter().any(|p| p == path))
    }

    /// PackageKit left the bus.
    pub fn gone(&mut self) -> Vec<Action> {
        self.end_where(|_| true)
    }

    fn end_where(&mut self, gone: impl Fn(&str) -> bool) -> Vec<Action> {
        let mut ended = Vec::new();
        self.transactions.retain(|path, t| {
            if !gone(path) {
                return true;
            }
            if t.sent.is_some() {
                ended.push(Action::End(activity_id(path), false, "Stopped".into()));
            }
            false
        });
        ended
    }
}
