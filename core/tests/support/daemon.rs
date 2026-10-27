use std::time::Duration;

use nokta_core::app::{self, RunOptions};
use nokta_core::shared::paths::Paths;
use tokio::task::JoinHandle;

use super::bus::TestBus;

pub const NAME: &str = "io.nokta.Nokta";

/// `noktad` running in-process on a test bus, with its own config and cache dirs.
pub struct Daemon {
    pub task: JoinHandle<anyhow::Result<()>>,
    pub config_home: tempfile::TempDir,
    pub cache_home: tempfile::TempDir,
}

impl Daemon {
    pub fn paths(&self) -> Paths {
        Paths::new(self.config_home.path(), self.cache_home.path())
    }

    pub fn options(bus: &TestBus, lrclib: &str) -> RunOptions {
        RunOptions {
            bus_address: Some(bus.address().to_owned()),
            lrclib_base_url: lrclib.to_owned(),
        }
    }

    pub async fn start(bus: &TestBus, lrclib: &str) -> Daemon {
        Daemon::start_with_config(bus, lrclib, None).await
    }

    pub async fn start_with_config(bus: &TestBus, lrclib: &str, config: Option<&str>) -> Daemon {
        let config_home = tempfile::tempdir().unwrap();
        let cache_home = tempfile::tempdir().unwrap();
        if let Some(text) = config {
            std::fs::create_dir_all(config_home.path().join("nokta")).unwrap();
            std::fs::write(config_home.path().join("nokta/config.toml"), text).unwrap();
        }
        let paths = Paths::new(config_home.path(), cache_home.path());
        let task = tokio::spawn(app::run(paths, Daemon::options(bus, lrclib)));
        wait_for_name(bus).await;
        Daemon {
            task,
            config_home,
            cache_home,
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn wait_for_name(bus: &TestBus) {
    let conn = bus.connect().await;
    let dbus = zbus::fdo::DBusProxy::new(&conn).await.unwrap();
    let name = zbus::names::BusName::try_from(NAME).unwrap();
    for _ in 0..250 {
        if dbus.name_has_owner(name.clone()).await.unwrap() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("noktad never took {NAME}");
}
