//! `io.nokta.Plugins1` at `/io/nokta/Plugins`.

use std::path::PathBuf;

use tokio::sync::{mpsc, watch};
use zbus::object_server::SignalEmitter;
use zbus::{fdo, Connection};

use super::catalog::Source;
use super::creator::Creator;
use super::service::{self, Command, Handle, Reply};
use super::PluginsState;
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Plugins";
pub const INTERFACE: &str = "io.nokta.Plugins1";

type Row = (String, bool, String, String, String);

pub async fn serve(
    conn: &Connection,
    handle: Handle,
    catalog: Source,
    creator: Creator,
) -> zbus::Result<()> {
    let Handle {
        commands,
        state,
        mut alerts,
    } = handle;
    conn.object_server()
        .at(
            PATH,
            PluginsInterface {
                commands,
                state: state.clone(),
                catalog,
                creator,
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    let conn = conn.clone();
    tokio::spawn(async move {
        let emitter = SignalEmitter::new(&conn, PATH).expect("static object path is valid");
        while let Some(a) = alerts.recv().await {
            let sent = PluginsInterface::alert(
                &emitter,
                &a.id,
                &a.title,
                &a.detail,
                &a.icon,
                &a.tone,
                a.important,
            )
            .await;
            if let Err(err) = sent {
                tracing::warn!(%err, "cannot emit Alert");
            }
        }
    });
    Ok(())
}

fn rows(state: &PluginsState) -> Vec<Row> {
    state
        .plugins
        .iter()
        .map(|p| {
            (
                p.id.clone(),
                p.enabled,
                p.status.clone(),
                p.message.clone(),
                p.info.clone(),
            )
        })
        .collect()
}

fn properties(state: &PluginsState) -> PropertyList {
    vec![
        ("Plugins", owned(rows(state))),
        ("Cards", owned(state.cards.clone())),
    ]
}

struct PluginsInterface {
    commands: mpsc::Sender<Command>,
    state: watch::Receiver<PluginsState>,
    catalog: Source,
    creator: Creator,
}

impl PluginsInterface {
    async fn ask<T>(&self, command: impl FnOnce(Reply<T>) -> Command) -> fdo::Result<T> {
        service::ask(&self.commands, command)
            .await
            .map_err(fdo::Error::InvalidArgs)
    }
}

#[zbus::interface(name = "io.nokta.Plugins1")]
impl PluginsInterface {
    #[zbus(property)]
    fn plugins(&self) -> Vec<Row> {
        rows(&self.state.borrow())
    }

    #[zbus(property)]
    fn cards(&self) -> Vec<(String, String)> {
        self.state.borrow().cards.clone()
    }

    async fn set_enabled(&self, id: String, enabled: bool) -> fdo::Result<()> {
        self.ask(|reply| Command::SetEnabled { id, enabled, reply })
            .await
    }

    async fn set_option(&self, id: String, key: String, value: String) -> fdo::Result<()> {
        self.ask(|reply| Command::SetOption {
            id,
            key,
            value,
            reply,
        })
        .await
    }

    async fn run(&self, id: String, action: String) -> fdo::Result<()> {
        self.ask(|reply| Command::Run { id, action, reply }).await
    }

    #[zbus(out_args("id"))]
    async fn install(&self, path: String) -> fdo::Result<String> {
        let path = PathBuf::from(path);
        self.ask(|reply| Command::Install { path, reply }).await
    }

    async fn remove(&self, id: String) -> fdo::Result<()> {
        self.ask(|reply| Command::Remove { id, reply }).await
    }

    /// The catalog's plugins as JSON; asks the catalog each time.
    #[zbus(out_args("catalog"))]
    async fn catalog(&self) -> fdo::Result<String> {
        self.catalog.browse().await.map_err(fdo::Error::Failed)
    }

    /// Installs or updates a plugin from the catalog; answers its id.
    #[zbus(out_args("id"))]
    async fn install_from_catalog(&self, id: String) -> fdo::Result<String> {
        self.catalog
            .install(&self.commands, &id)
            .await
            .map_err(fdo::Error::Failed)
    }

    /// Creator Mode's service as JSON, without its key.
    #[zbus(out_args("creator"))]
    fn creator(&self) -> String {
        self.creator.settings().to_json()
    }

    /// Sets Creator Mode's service; an empty key keeps the saved one.
    fn set_creator(
        &self,
        provider: String,
        model: String,
        base_url: String,
        api_key: String,
    ) -> fdo::Result<()> {
        self.creator
            .configure(&provider, &model, &base_url, &api_key)
            .map_err(fdo::Error::InvalidArgs)
    }

    /// Has the model write the plugin `request` describes, and installs it
    /// off; answers its id.
    #[zbus(out_args("id"))]
    async fn create(&self, request: String) -> fdo::Result<String> {
        let taken: Vec<String> = self
            .state
            .borrow()
            .plugins
            .iter()
            .map(|p| p.id.clone())
            .collect();
        self.creator
            .create(&self.commands, &taken, &request)
            .await
            .map_err(fdo::Error::Failed)
    }

    #[zbus(signal)]
    async fn alert(
        emitter: &SignalEmitter<'_>,
        id: &str,
        title: &str,
        detail: &str,
        icon: &str,
        tone: &str,
        important: bool,
    ) -> zbus::Result<()>;
}
