//! `io.nokta.System1` at `/io/nokta/System`.

use futures_util::StreamExt;
use tokio::sync::{mpsc, watch};
use zbus::message::Header;
use zbus::object_server::SignalEmitter;
use zbus::{fdo, Connection, MatchRule, MessageStream};

use super::model::Usage;
use super::service::{Command, Handle};
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/System";
pub const INTERFACE: &str = "io.nokta.System1";

type UsageTuple = (f64, u64, u64, f64, f64, f64);

pub async fn serve(conn: &Connection, handle: Handle) -> zbus::Result<()> {
    let Handle {
        commands,
        usage,
        mut memory_low,
    } = handle;
    follow_leavers(conn, commands.clone()).await?;
    conn.object_server()
        .at(
            PATH,
            SystemInterface {
                commands,
                usage: usage.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, usage, properties);
    let conn = conn.clone();
    tokio::spawn(async move {
        let emitter = SignalEmitter::new(&conn, PATH).expect("static object path is valid");
        while let Some(low) = memory_low.recv().await {
            let sent = SystemInterface::memory_low(&emitter, low.used, low.total, &low.app).await;
            if let Err(err) = sent {
                tracing::warn!(%err, "cannot emit MemoryLow");
            }
        }
    });
    Ok(())
}

fn tuple(u: &Usage) -> UsageTuple {
    (
        u.cpu,
        u.memory_used,
        u.memory_total,
        u.temperature,
        u.download,
        u.upload,
    )
}

fn properties(usage: &Usage) -> PropertyList {
    vec![("Usage", owned(tuple(usage)))]
}

/// A client that leaves the bus stops watching, so a crash never leaves the
/// sampler running.
async fn follow_leavers(conn: &Connection, commands: mpsc::Sender<Command>) -> zbus::Result<()> {
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .sender("org.freedesktop.DBus")?
        .interface("org.freedesktop.DBus")?
        .member("NameOwnerChanged")?
        .arg(2, "")?
        .build();
    let mut stream = MessageStream::for_match_rule(rule, conn, None).await?;
    tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            let Ok((name, _old, new)) = msg.body().deserialize::<(String, String, String)>() else {
                continue;
            };
            if name.starts_with(':')
                && new.is_empty()
                && commands.send(Command::Gone(name)).await.is_err()
            {
                break;
            }
        }
    });
    Ok(())
}

struct SystemInterface {
    commands: mpsc::Sender<Command>,
    usage: watch::Receiver<Usage>,
}

impl SystemInterface {
    async fn send(&self, header: &Header<'_>, command: fn(String) -> Command) -> fdo::Result<()> {
        let sender = header
            .sender()
            .map(|s| s.to_string())
            .ok_or_else(|| fdo::Error::Failed("no sender".into()))?;
        self.commands
            .send(command(sender))
            .await
            .map_err(|_| fdo::Error::Failed("the system service has stopped".into()))
    }
}

#[zbus::interface(name = "io.nokta.System1")]
impl SystemInterface {
    #[zbus(property)]
    fn usage(&self) -> UsageTuple {
        tuple(&self.usage.borrow())
    }

    async fn watch(&self, #[zbus(header)] header: Header<'_>) -> fdo::Result<()> {
        self.send(&header, Command::Watch).await
    }

    async fn unwatch(&self, #[zbus(header)] header: Header<'_>) -> fdo::Result<()> {
        self.send(&header, Command::Unwatch).await
    }

    #[zbus(signal)]
    async fn memory_low(
        emitter: &SignalEmitter<'_>,
        used: u64,
        total: u64,
        app: &str,
    ) -> zbus::Result<()>;
}
