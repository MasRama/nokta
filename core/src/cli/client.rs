//! Talks to `io.nokta.Activities1` on the session bus.

use zbus::Connection;

const BUS_NAME: &str = "io.nokta.Nokta";
const PATH: &str = "/io/nokta/Activities";
const INTERFACE: &str = "io.nokta.Activities1";

pub struct Client {
    proxy: zbus::Proxy<'static>,
}

impl Client {
    pub async fn connect() -> zbus::Result<Client> {
        let conn = Connection::session().await?;
        let proxy = zbus::Proxy::new(&conn, BUS_NAME, PATH, INTERFACE).await?;
        Ok(Client { proxy })
    }

    pub async fn set(
        &self,
        id: &str,
        title: &str,
        detail: &str,
        icon: &str,
        progress: f64,
    ) -> zbus::Result<()> {
        self.proxy
            .call("Set", &(id, title, detail, icon, progress))
            .await
    }

    pub async fn end(&self, id: &str, success: bool, message: &str) -> zbus::Result<()> {
        self.proxy.call("End", &(id, success, message)).await
    }
}
