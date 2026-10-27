//! Wires the features together and serves them on the session bus.

mod nokta_iface;

use std::sync::Arc;

use anyhow::Context;
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::{mpsc, watch};
use zbus::fdo::{DBusProxy, RequestNameFlags, RequestNameReply};
use zbus::names::BusName;
use zbus::Connection;

use crate::features::lyrics::{self, cache::Cache, lrclib};
use crate::features::media::{self, art::ArtCache};
use crate::features::settings::{self, Config, Store};
use crate::shared::paths::Paths;

pub const BUS_NAME: &str = "io.nokta.Nokta";
pub const DEFAULT_LRCLIB_URL: &str = "https://lrclib.net";
pub const USER_AGENT: &str = concat!(
    "Nokta/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/MasRama/nokta)"
);

pub struct RunOptions {
    /// Bus to connect to instead of the session bus (tests use a private one).
    pub bus_address: Option<String>,
    pub lrclib_base_url: String,
}

/// Runs the daemon until SIGTERM or SIGINT. Returns `Ok` straight away when
/// another instance already owns the bus name.
pub async fn run(paths: Paths, options: RunOptions) -> anyhow::Result<()> {
    let conn = connect(options.bus_address.as_deref()).await?;
    let dbus = DBusProxy::new(&conn).await?;
    if dbus.name_has_owner(BusName::try_from(BUS_NAME)?).await? {
        tracing::info!("another noktad is running");
        return Ok(());
    }

    let http = reqwest::Client::builder().user_agent(USER_AGENT).build()?;
    let (media_state, control) =
        media::watcher::spawn(conn.clone(), ArtCache::new(paths.cache_dir.clone(), http));

    let store = Store::load_or_init(&paths.config_file);
    // The watcher must live as long as the daemon.
    let (_config_watcher, changes) = match settings::watch(paths.config_file.clone()) {
        Ok((watcher, changes)) => (Some(watcher), changes),
        Err(err) => {
            tracing::warn!("cannot watch {}: {err:#}", paths.config_file.display());
            (None, mpsc::channel(1).1)
        }
    };
    let config = settings::service::spawn(store, changes);

    let lyrics_state = lyrics::service::spawn(
        media_state.clone(),
        lyrics_enabled(config.clone()),
        Cache::new(paths.cache_dir.join("lyrics")),
        Arc::new(lrclib::Client::new(&options.lrclib_base_url, USER_AGENT)),
    );

    // Objects first, name last: a client activated by the name never sees a
    // half-served daemon.
    conn.object_server()
        .at(nokta_iface::PATH, nokta_iface::NoktaInterface)
        .await?;
    media::dbus::serve(&conn, media_state, control).await?;
    lyrics::dbus::serve(&conn, lyrics_state).await?;
    settings::dbus::serve(&conn, config).await?;

    match conn
        .request_name_with_flags(BUS_NAME, RequestNameFlags::DoNotQueue.into())
        .await
    {
        Ok(RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner) => {}
        Ok(_) | Err(zbus::Error::NameTaken) => {
            tracing::info!("another noktad is running");
            return Ok(());
        }
        Err(err) => return Err(err).context("cannot request the bus name"),
    }
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "noktad is running");

    let mut term = signal(SignalKind::terminate())?;
    let mut int = signal(SignalKind::interrupt())?;
    tokio::select! {
        _ = term.recv() => {}
        _ = int.recv() => {}
    }
    tracing::info!("noktad is stopping");
    Ok(())
}

async fn connect(address: Option<&str>) -> anyhow::Result<Connection> {
    let builder = match address {
        Some(address) => zbus::connection::Builder::address(address)?,
        None => zbus::connection::Builder::session()?,
    };
    builder
        .build()
        .await
        .context("cannot connect to the session bus")
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
