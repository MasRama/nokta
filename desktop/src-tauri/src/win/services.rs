//! The core's services, started in the app's own Tokio runtime, and what
//! the page reaches of them: an interface's properties (`bridge_props`),
//! their changes (the `nokta://props` event) and its methods
//! (`bridge_call`), named as in `contracts/*.xml`.

use std::sync::Mutex;

use nokta_core::app::{OpenMeteoUrls, Services, DEFAULT_LRCLIB_URL};
use nokta_core::features::media::MediaState;
use nokta_core::features::settings::picture::Prepared;
use nokta_core::features::settings::{Config, Writer};
use nokta_core::shared::paths::Paths;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

use crate::bridge::{nokta, settings, Props};
use crate::layout::NotchSizes;

/// The event that carries an interface's changed properties to every page.
pub const PROPS_EVENT: &str = "nokta://props";

#[derive(Clone, serde::Serialize)]
struct Changed {
    interface: &'static str,
    props: Props,
}

pub struct Core {
    config: watch::Receiver<Config>,
    picture: watch::Receiver<Prepared>,
    writer: Writer,
    /// The media state the Windows media source will publish.
    _media: watch::Sender<MediaState>,
    /// Keeps the services and their watchers alive.
    _services: Mutex<Services>,
}

impl Core {
    /// The config as it is now.
    pub fn config(&self) -> Config {
        self.config.borrow().clone()
    }
}

/// Starts the services and the forwarders; the app manages the result.
pub fn start(app: &AppHandle, paths: &Paths) -> Core {
    let (media, media_state) = watch::channel(MediaState::default());
    let services = tauri::async_runtime::block_on(async {
        Services::start(
            paths,
            media_state,
            DEFAULT_LRCLIB_URL,
            &OpenMeteoUrls::default(),
        )
    });
    forward_settings(
        app.clone(),
        services.config.clone(),
        services.picture.clone(),
    );
    Core {
        config: services.config.clone(),
        picture: services.picture.clone(),
        writer: Writer::new(services.config_file.clone()),
        _media: media,
        _services: Mutex::new(services),
    }
}

/// Sends Settings1 again on each change of the config or the picture, and
/// fits the notch windows to new sizes.
fn forward_settings(
    app: AppHandle,
    mut config: watch::Receiver<Config>,
    mut picture: watch::Receiver<Prepared>,
) {
    tauri::async_runtime::spawn(async move {
        let mut sizes = NotchSizes::from(&config.borrow().appearance);
        loop {
            tokio::select! {
                changed = config.changed() => if changed.is_err() { break },
                changed = picture.changed() => if changed.is_err() { break },
            }
            let (props, next) = {
                let config = config.borrow_and_update();
                let props = settings::props(&config, &picture.borrow_and_update());
                (props, NotchSizes::from(&config.appearance))
            };
            if next != sizes {
                sizes = next;
                super::fit_windows(&app, &sizes);
            }
            let _ = app.emit(
                PROPS_EVENT,
                Changed {
                    interface: settings::INTERFACE,
                    props,
                },
            );
        }
    });
}

/// An interface's properties as they are now.
#[tauri::command]
pub fn bridge_props(core: State<'_, Core>, interface: String) -> Result<Props, String> {
    match interface.as_str() {
        nokta::INTERFACE => Ok(nokta::props()),
        settings::INTERFACE => Ok(settings::props(
            &core.config.borrow(),
            &core.picture.borrow(),
        )),
        other => Err(format!("no interface {other}")),
    }
}

/// Calls `interface.method(args)`.
#[tauri::command]
pub async fn bridge_call(
    core: State<'_, Core>,
    interface: String,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    match (interface.as_str(), method.as_str(), args.as_slice()) {
        ("Settings1", "Set", [Value::String(table), Value::String(key), value]) => {
            let value = settings::setting_value(value)
                .ok_or_else(|| format!("{table}.{key} cannot be {value}"))?;
            core.writer
                .set(table, key, &value)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        ("Settings1", "Reset", []) => {
            core.writer.reset().await.map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err(format!(
            "no method {interface}.{method} for {} arguments",
            args.len()
        )),
    }
}
