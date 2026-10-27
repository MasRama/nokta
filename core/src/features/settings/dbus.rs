//! `io.nokta.Settings1` at `/io/nokta/Settings`.

use std::collections::HashMap;

use tokio::sync::watch;
use zbus::zvariant::OwnedValue;
use zbus::Connection;

use super::Config;
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Settings";
pub const INTERFACE: &str = "io.nokta.Settings1";

pub async fn serve(conn: &Connection, config: watch::Receiver<Config>) -> zbus::Result<()> {
    conn.object_server()
        .at(
            PATH,
            SettingsInterface {
                config: config.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, config, properties);
    Ok(())
}

fn properties(c: &Config) -> PropertyList {
    vec![
        ("Appearance", owned(c.appearance.to_dbus())),
        ("Behavior", owned(c.behavior.to_dbus())),
    ]
}

struct SettingsInterface {
    config: watch::Receiver<Config>,
}

#[zbus::interface(name = "io.nokta.Settings1")]
impl SettingsInterface {
    #[zbus(property)]
    fn appearance(&self) -> HashMap<String, OwnedValue> {
        self.config.borrow().appearance.to_dbus()
    }

    #[zbus(property)]
    fn behavior(&self) -> HashMap<String, OwnedValue> {
        self.config.borrow().behavior.to_dbus()
    }
}
