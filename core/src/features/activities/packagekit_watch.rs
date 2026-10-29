//! Follows PackageKit's transactions on the system bus and turns installs,
//! removals and updates into activities. Nokta never starts PackageKit: it
//! only listens while something else runs it, and calls it by its unique
//! name, which the bus never activates.

use std::collections::HashMap;

use futures_util::StreamExt;
use tokio::sync::mpsc;
use zbus::fdo::{DBusProxy, PropertiesChanged, PropertiesProxy};
use zbus::message::Type;
use zbus::names::{BusName, OwnedUniqueName};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};
use zbus::{Connection, MatchRule, Message, MessageStream};

use super::launcher::Action;
use super::launcher_watch::send;
use super::packagekit::{PackageKitState, Props};
use super::service::Command;

const SERVICE: &str = "org.freedesktop.PackageKit";
const PATH: &str = "/org/freedesktop/PackageKit";
const TRANSACTION: &str = "org.freedesktop.PackageKit.Transaction";

/// Watches until the system bus goes; `enabled` is read for every change.
pub fn spawn(
    system: Option<Connection>,
    commands: mpsc::Sender<Command>,
    enabled: impl Fn() -> bool + Send + 'static,
) {
    let Some(conn) = system else { return };
    tokio::spawn(async move {
        if let Err(err) = watch(conn, commands, enabled).await {
            tracing::warn!("no progress from PackageKit: {err}");
        }
    });
}

fn props<'a>(values: impl IntoIterator<Item = (&'a str, &'a Value<'a>)>) -> Props {
    let mut props = Props::default();
    for (name, value) in values {
        match name {
            "Role" => props.role = value.downcast_ref().ok(),
            "Status" => props.status = value.downcast_ref().ok(),
            "Percentage" => props.percentage = value.downcast_ref().ok(),
            "TransactionFlags" => props.flags = value.downcast_ref().ok(),
            _ => {}
        }
    }
    props
}

async fn watch(
    conn: Connection,
    commands: mpsc::Sender<Command>,
    enabled: impl Fn() -> bool,
) -> zbus::Result<()> {
    let rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender("org.freedesktop.DBus")?
        .interface("org.freedesktop.DBus")?
        .member("NameOwnerChanged")?
        .arg(0, SERVICE)?
        .build();
    let mut owners = MessageStream::for_match_rule(rule, &conn, None).await?;
    // One stream for all of PackageKit's signals keeps their order: a
    // `Finished` comes before the list that leaves its transaction out.
    let rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender(SERVICE)?
        .build();
    let mut signals = MessageStream::for_match_rule(rule, &conn, None).await?;

    // GetNameOwner only asks the bus; it never starts PackageKit.
    let owner = DBusProxy::new(&conn)
        .await?
        .get_name_owner(BusName::try_from(SERVICE)?)
        .await
        .ok();
    let mut state = PackageKitState::default();
    if let Some(owner) = &owner {
        if enabled() {
            let actions = list(&conn, owner, &mut state).await;
            send_all(&commands, actions).await;
        }
    }
    loop {
        let actions = tokio::select! {
            Some(Ok(msg)) = owners.next() => {
                // Only its leaving matters: a new PackageKit announces its transactions.
                match msg.body().deserialize::<(String, String, String)>() {
                    Ok((_, _, new)) if new.is_empty() => state.gone(),
                    _ => continue,
                }
            }
            Some(Ok(msg)) = signals.next() => {
                // Its sender is PackageKit's unique name, even before `owners` says it started.
                let sender = msg.header().sender().map(|s| OwnedUniqueName::from(s.to_owned()));
                let (Some(sender), true) = (sender, enabled()) else { continue };
                signal(&conn, &sender, &mut state, msg).await
            }
            else => break,
        };
        send_all(&commands, actions).await;
    }
    Ok(())
}

async fn signal(
    conn: &Connection,
    owner: &OwnedUniqueName,
    state: &mut PackageKitState,
    msg: Message,
) -> Vec<Action> {
    let header = msg.header();
    let (Some(interface), Some(member), Some(path)) =
        (header.interface(), header.member(), header.path())
    else {
        return vec![];
    };
    let path = path.to_string();
    match (interface.as_str(), member.as_str()) {
        (SERVICE, "TransactionListChanged") => {
            let Ok((paths,)) = msg.body().deserialize::<(Vec<String>,)>() else {
                return vec![];
            };
            let mut actions = state.listed(&paths);
            let new: Vec<_> = paths.iter().filter(|p| !state.knows(p)).collect();
            for path in new {
                actions.extend(read(conn, owner, path, state, Props::default()).await);
            }
            actions
        }
        (TRANSACTION, "Finished") => match msg.body().deserialize::<(u32, u32)>() {
            Ok((exit, _)) => state.finished(&path, exit),
            Err(_) => vec![],
        },
        ("org.freedesktop.DBus.Properties", "PropertiesChanged") => {
            let Some(signal) = PropertiesChanged::from_message(msg.clone()) else {
                return vec![];
            };
            let Ok(args) = signal.args() else {
                return vec![];
            };
            if args.interface_name.as_str() != TRANSACTION {
                return vec![];
            }
            let changed = props(args.changed_properties().iter().map(|(k, v)| (*k, v)));
            if changed.role.is_some() || !state.knows(&path) {
                // The role comes with flags read once, so a simulation never flashes.
                read(conn, owner, &path, state, changed).await
            } else {
                state.changed(&path, changed)
            }
        }
        _ => vec![],
    }
}

async fn send_all(commands: &mpsc::Sender<Command>, actions: Vec<Action>) {
    for action in actions {
        send(commands, action).await;
    }
}

/// Every running transaction, as PackageKit lists it.
async fn list(
    conn: &Connection,
    owner: &OwnedUniqueName,
    state: &mut PackageKitState,
) -> Vec<Action> {
    let reply = conn
        .call_method(
            Some(owner.as_str()),
            PATH,
            Some(SERVICE),
            "GetTransactionList",
            &(),
        )
        .await;
    let paths = match reply.and_then(|r| r.body().deserialize::<Vec<OwnedObjectPath>>()) {
        Ok(paths) => paths,
        Err(err) => {
            tracing::debug!("PackageKit transactions not listed: {err}");
            return vec![];
        }
    };
    let mut actions = Vec::new();
    for path in paths {
        actions.extend(read(conn, owner, path.as_str(), state, Props::default()).await);
    }
    actions
}

/// The transaction's properties read whole; `known` when the read fails.
async fn read(
    conn: &Connection,
    owner: &OwnedUniqueName,
    path: &str,
    state: &mut PackageKitState,
    known: Props,
) -> Vec<Action> {
    let all = get_all(conn, owner, path).await;
    let props = match &all {
        Ok(values) => props(values.iter().map(|(k, v)| (k.as_str(), &**v))),
        Err(err) => {
            tracing::debug!("PackageKit transaction {path} not read: {err}");
            known
        }
    };
    state.changed(path, props)
}

async fn get_all(
    conn: &Connection,
    owner: &OwnedUniqueName,
    path: &str,
) -> zbus::Result<HashMap<String, OwnedValue>> {
    let proxy = PropertiesProxy::builder(conn)
        .destination(owner.as_str())?
        .path(path.to_owned())?
        .cache_properties(zbus::proxy::CacheProperties::No)
        .build()
        .await?;
    Ok(proxy
        .get_all(zbus::names::InterfaceName::try_from(TRANSACTION)?)
        .await?)
}
