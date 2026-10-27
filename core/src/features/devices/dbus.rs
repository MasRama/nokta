//! `io.nokta.Devices1` at `/io/nokta/Devices`.

use tokio::sync::mpsc;
use zbus::object_server::SignalEmitter;
use zbus::Connection;

use super::rules::Alert;

pub const PATH: &str = "/io/nokta/Devices";

pub async fn serve(conn: &Connection, mut alerts: mpsc::Receiver<Alert>) -> zbus::Result<()> {
    conn.object_server().at(PATH, DevicesInterface).await?;
    let conn = conn.clone();
    tokio::spawn(async move {
        let emitter = SignalEmitter::new(&conn, PATH).expect("static object path is valid");
        while let Some(alert) = alerts.recv().await {
            tracing::debug!(?alert, "device alert");
            let sent = DevicesInterface::alert(
                &emitter,
                alert.kind.as_str(),
                &alert.name,
                alert.percentage,
            )
            .await;
            if let Err(err) = sent {
                tracing::warn!(%err, "cannot emit Alert");
            }
        }
    });
    Ok(())
}

struct DevicesInterface;

#[zbus::interface(name = "io.nokta.Devices1")]
impl DevicesInterface {
    #[zbus(signal)]
    async fn alert(
        emitter: &SignalEmitter<'_>,
        kind: &str,
        name: &str,
        percentage: i32,
    ) -> zbus::Result<()>;
}
