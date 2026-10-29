//! Listens for `com.canonical.Unity.LauncherEntry.Update` from any app on
//! the session bus and turns it into activities.

use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use tokio::sync::{mpsc, oneshot};
use zbus::zvariant::OwnedValue;
use zbus::{Connection, MatchRule, MessageStream};

use super::desktop::{app_for, data_dirs};
use super::launcher::{Action, LauncherState, Report};
use super::service::Command;
use crate::shared::clock::monotonic_us;

const INTERFACE: &str = "com.canonical.Unity.LauncherEntry";

/// Watches until the bus goes; `enabled` is read for every report.
pub fn spawn(
    conn: Connection,
    commands: mpsc::Sender<Command>,
    enabled: impl Fn() -> bool + Send + 'static,
) {
    tokio::spawn(async move {
        if let Err(err) = watch(conn, commands, enabled).await {
            tracing::warn!("no progress from the dock: {err}");
        }
    });
}

/// The keys of one report that the notch reads.
fn report(props: &HashMap<String, OwnedValue>) -> Report {
    Report {
        progress: props.get("progress").and_then(|v| v.downcast_ref().ok()),
        visible: props
            .get("progress-visible")
            .and_then(|v| v.downcast_ref().ok()),
    }
}

async fn watch(
    conn: Connection,
    commands: mpsc::Sender<Command>,
    enabled: impl Fn() -> bool,
) -> zbus::Result<()> {
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(INTERFACE)?
        .member("Update")?
        .build();
    let mut updates = MessageStream::for_match_rule(rule, &conn, None).await?;
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .sender("org.freedesktop.DBus")?
        .interface("org.freedesktop.DBus")?
        .member("NameOwnerChanged")?
        .build();
    let mut owners = MessageStream::for_match_rule(rule, &conn, None).await?;
    let dirs = data_dirs();
    let mut state = LauncherState::default();
    loop {
        let wait = state
            .next_deadline()
            .map(|at| Duration::from_micros((at - monotonic_us()).max(0) as u64));
        let actions = tokio::select! {
            Some(Ok(msg)) = updates.next() => {
                let sender = msg.header().sender().map(|s| s.to_string()).unwrap_or_default();
                let Ok((uri, props)) = msg.body().deserialize::<(String, HashMap<String, OwnedValue>)>() else {
                    continue;
                };
                if !enabled() {
                    continue;
                }
                state.update(&sender, &uri, report(&props), |id| app_for(id, &dirs), monotonic_us())
            }
            Some(Ok(msg)) = owners.next() => {
                let Ok((name, _, new)) = msg.body().deserialize::<(String, String, String)>() else {
                    continue;
                };
                if !new.is_empty() || !name.starts_with(':') {
                    continue;
                }
                state.sender_gone(&name)
            }
            () = sleep(wait) => state.tick(monotonic_us()),
            else => break,
        };
        for action in actions {
            send(&commands, action).await;
        }
    }
    Ok(())
}

async fn send(commands: &mpsc::Sender<Command>, action: Action) {
    let command = match action {
        Action::Set(id, update) => {
            let (reply, answer) = oneshot::channel();
            if commands
                .send(Command::Set { id, update, reply })
                .await
                .is_ok()
            {
                if let Ok(Err(err)) = answer.await {
                    tracing::debug!("dock progress not shown: {err}");
                }
            }
            return;
        }
        Action::End(id, success, message) => Command::End {
            id,
            success,
            message,
        },
    };
    let _ = commands.send(command).await;
}

async fn sleep(wait: Option<Duration>) {
    match wait {
        Some(wait) => tokio::time::sleep(wait).await,
        None => std::future::pending().await,
    }
}
