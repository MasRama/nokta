//! Serves Nokta on the session bus: the media players and device alerts
//! from D-Bus, and the portable services.

use anyhow::Context;
use tokio::signal::unix::{signal, SignalKind};
use zbus::fdo::{DBusProxy, RequestNameFlags, RequestNameReply};
use zbus::names::BusName;
use zbus::Connection;

use super::{nokta_iface, RunOptions, Services, BUS_NAME, USER_AGENT};
use crate::features::activities;
use crate::features::clipboard;
use crate::features::devices;
use crate::features::lyrics;
use crate::features::media::{self, art::ArtCache};
use crate::features::settings;
use crate::features::shelf;
use crate::features::timer;
use crate::features::weather;
use crate::shared::http;
use crate::shared::paths::Paths;

pub async fn run(paths: Paths, options: RunOptions) -> anyhow::Result<()> {
    let conn = connect(options.bus_address.as_deref()).await?;
    let dbus = DBusProxy::new(&conn).await?;
    if dbus.name_has_owner(BusName::try_from(BUS_NAME)?).await? {
        tracing::info!("another noktad is running");
        return Ok(());
    }

    let http = http::client(|b| b.user_agent(USER_AGENT));
    let (media_state, control) =
        media::watcher::spawn(conn.clone(), ArtCache::new(paths.cache_dir.clone(), http));
    // Keeps watching config.toml until the daemon stops.
    let services = Services::start(
        &paths,
        media_state.clone(),
        &options.lrclib_base_url,
        &options.open_meteo,
    );

    let system = match connect_system(options.system_bus_address.as_deref()).await {
        Ok(system) => Some(system),
        Err(err) => {
            tracing::warn!("no device alerts: {err:#}");
            None
        }
    };
    let resume = system.clone();
    let alerts = devices::watcher::spawn(system);

    // Objects first, name last: a client activated by the name never sees a
    // half-served daemon.
    conn.object_server()
        .at(nokta_iface::PATH, nokta_iface::NoktaInterface)
        .await?;
    media::dbus::serve(&conn, media_state, control).await?;
    lyrics::dbus::serve(&conn, services.lyrics).await?;
    settings::dbus::serve(
        &conn,
        services.config.clone(),
        services.picture.clone(),
        services.config_file.clone(),
    )
    .await?;
    devices::dbus::serve(&conn, alerts).await?;
    activities::dbus::serve(&conn, services.activities).await?;
    weather::dbus::serve(&conn, services.weather).await?;
    shelf::dbus::serve(&conn, services.shelf).await?;
    clipboard::dbus::serve(&conn, services.clipboard).await?;
    let super::Timer {
        commands,
        state,
        finished,
        clocks,
    } = services.timer;
    if let Some(system) = resume {
        let commands = clocks.commands.clone();
        tokio::spawn(async move {
            if let Err(err) = timer::dbus::watch_resume(system, commands).await {
                tracing::warn!("alarms will not notice a resume: {err}");
            }
        });
    }
    timer::dbus::serve(&conn, commands, state, finished, clocks).await?;

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

async fn connect_system(address: Option<&str>) -> anyhow::Result<Connection> {
    let builder = match address {
        Some(address) => zbus::connection::Builder::address(address)?,
        None => zbus::connection::Builder::system()?,
    };
    builder
        .build()
        .await
        .context("cannot connect to the system bus")
}
