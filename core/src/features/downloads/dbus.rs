//! `io.nokta.Downloads1` at `/io/nokta/Downloads`.

use tokio::sync::mpsc;
use zbus::object_server::SignalEmitter;
use zbus::Connection;

use super::service::Finished;

pub const PATH: &str = "/io/nokta/Downloads";

pub async fn serve(conn: &Connection, mut finished: mpsc::Receiver<Finished>) -> zbus::Result<()> {
    conn.object_server().at(PATH, DownloadsInterface).await?;
    let conn = conn.clone();
    tokio::spawn(async move {
        let emitter = SignalEmitter::new(&conn, PATH).expect("static object path is valid");
        while let Some(file) = finished.recv().await {
            let sent = DownloadsInterface::finished(
                &emitter,
                &file.uri,
                &file.name,
                &file.icon,
                file.size,
                &file.thumbnail,
            )
            .await;
            if let Err(err) = sent {
                tracing::warn!(%err, "cannot emit Finished");
            }
        }
    });
    Ok(())
}

struct DownloadsInterface;

#[zbus::interface(name = "io.nokta.Downloads1")]
impl DownloadsInterface {
    #[zbus(signal)]
    async fn finished(
        emitter: &SignalEmitter<'_>,
        uri: &str,
        name: &str,
        icon: &str,
        size: u64,
        thumbnail: &str,
    ) -> zbus::Result<()>;
}
