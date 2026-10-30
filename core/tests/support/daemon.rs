use std::time::Duration;

use nokta_core::app::{self, OpenMeteoUrls, RunOptions};
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
        Paths::new(
            self.config_home.path(),
            self.cache_home.path(),
            &self.config_home.path().join("data"),
        )
    }

    pub fn options(bus: &TestBus, lrclib: &str) -> RunOptions {
        RunOptions {
            bus_address: Some(bus.address().to_owned()),
            system_bus_address: Some(bus.address().to_owned()),
            lrclib_base_url: lrclib.to_owned(),
            // Tests that want weather point these at their own server.
            open_meteo: OpenMeteoUrls {
                forecast: "http://127.0.0.1:9".into(),
                geocoding: "http://127.0.0.1:9".into(),
            },
            // Tests that want releases point this at their own server.
            github_api_url: "http://127.0.0.1:9".into(),
            // Tests that want the bars to follow the music bring their own.
            recorder: "/nonexistent/pw-record".into(),
        }
    }

    pub async fn start(bus: &TestBus, lrclib: &str) -> Daemon {
        Daemon::start_with_config(bus, lrclib, None).await
    }

    pub async fn start_with_config(bus: &TestBus, lrclib: &str, config: Option<&str>) -> Daemon {
        Daemon::start_with(bus, Daemon::options(bus, lrclib), config).await
    }

    pub async fn start_with(bus: &TestBus, options: RunOptions, config: Option<&str>) -> Daemon {
        let config_home = tempfile::tempdir().unwrap();
        let cache_home = tempfile::tempdir().unwrap();
        if let Some(text) = config {
            std::fs::create_dir_all(config_home.path().join("nokta")).unwrap();
            std::fs::write(config_home.path().join("nokta/config.toml"), text).unwrap();
        }
        let paths = Paths::new(
            config_home.path(),
            cache_home.path(),
            &config_home.path().join("data"),
        );
        let task = tokio::spawn(app::run(paths, options));
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
