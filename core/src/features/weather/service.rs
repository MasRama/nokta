//! Keeps `WeatherState` for the `[weather]` table. It asks when it starts,
//! when the location or units change, and on `refresh` once the last answer
//! is stale. Requests run one at a time, and a failed one keeps the last
//! reading.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use tokio::sync::{mpsc, watch};

use super::model::{is_due, Attempt, Coordinates, Forecast, Location, Units};
use super::openmeteo::{Client, FetchError, Place};
use super::{Reading, Status, WeatherState};
use crate::features::settings::WeatherConfig;

/// Where weather comes from. Implemented by the Open-Meteo client; tests inject fakes.
pub trait WeatherSource: Send + Sync {
    fn locate<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<Place>, FetchError>>;
    fn forecast(
        &self,
        at: Coordinates,
        units: Units,
    ) -> BoxFuture<'_, Result<Forecast, FetchError>>;
}

impl WeatherSource for Client {
    fn locate<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<Place>, FetchError>> {
        Box::pin(Client::locate(self, name))
    }

    fn forecast(
        &self,
        at: Coordinates,
        units: Units,
    ) -> BoxFuture<'_, Result<Forecast, FetchError>> {
        Box::pin(Client::forecast(self, at, units))
    }
}

pub struct Handle {
    /// Asks for new weather if the last answer is stale.
    pub refresh: mpsc::Sender<()>,
    pub state: watch::Receiver<WeatherState>,
}

/// `now` reads the monotonic clock in microseconds.
pub fn spawn(
    config: watch::Receiver<WeatherConfig>,
    source: Arc<dyn WeatherSource>,
    now: impl Fn() -> i64 + Send + Sync + 'static,
) -> Handle {
    let (refresh, requests) = mpsc::channel(4);
    let (tx, state) = watch::channel(WeatherState::default());
    tokio::spawn(run(config, requests, source, now, tx));
    Handle { refresh, state }
}

/// What the config asks for; `location` is `None` when weather is off.
#[derive(Clone, Debug, PartialEq)]
struct Wanted {
    location: Option<Location>,
    units: Units,
}

impl Wanted {
    fn from(config: &WeatherConfig) -> Wanted {
        Wanted {
            location: if config.enabled {
                Location::parse(&config.location)
            } else {
                None
            },
            units: Units::from_config(&config.units),
        }
    }
}

enum Failure {
    NotFound(String),
    Fetch(FetchError),
}

async fn run(
    mut config: watch::Receiver<WeatherConfig>,
    mut requests: mpsc::Receiver<()>,
    source: Arc<dyn WeatherSource>,
    now: impl Fn() -> i64,
    tx: watch::Sender<WeatherState>,
) {
    let mut wanted = Wanted::from(&config.borrow_and_update());
    tx.send_modify(|s| s.units = wanted.units);
    let mut last: Option<Attempt> = None;
    // The last place found by name, so a refresh does not look it up again.
    let mut found: Option<(String, Place)> = None;
    let mut ask = true;
    loop {
        if ask {
            ask = false;
            if let Some(location) = wanted.location.clone() {
                tx.send_if_modified(|s| {
                    let loading = s.reading.is_none() && s.status != Status::Loading;
                    if loading {
                        s.status = Status::Loading;
                    }
                    loading
                });
                let result = fetch(source.as_ref(), &location, wanted.units, &mut found).await;
                // The config changed while asking: this answer is for the old one.
                if Wanted::from(&config.borrow()) == wanted {
                    last = Some(Attempt {
                        at_us: now(),
                        ok: result.is_ok(),
                    });
                    publish(&tx, wanted.units, result);
                }
            }
        }
        tokio::select! {
            changed = config.changed() => {
                if changed.is_err() {
                    return;
                }
                let next = Wanted::from(&config.borrow_and_update());
                if next != wanted {
                    wanted = next;
                    last = None;
                    tx.send_replace(WeatherState {
                        status: Status::Off,
                        units: wanted.units,
                        reading: None,
                    });
                    ask = true;
                }
            }
            request = requests.recv() => {
                if request.is_none() {
                    return;
                }
                ask = is_due(last, now());
            }
        }
    }
}

async fn fetch(
    source: &dyn WeatherSource,
    location: &Location,
    units: Units,
    found: &mut Option<(String, Place)>,
) -> Result<Reading, Failure> {
    let (place, at) = match location {
        Location::At(at) => (String::new(), *at),
        Location::Named(name) => {
            let place = match found {
                Some((key, place)) if key == name => place.clone(),
                _ => {
                    let place = source
                        .locate(name)
                        .await
                        .map_err(Failure::Fetch)?
                        .ok_or_else(|| Failure::NotFound(name.clone()))?;
                    *found = Some((name.clone(), place.clone()));
                    place
                }
            };
            (place.name, place.at)
        }
    };
    let f = source.forecast(at, units).await.map_err(Failure::Fetch)?;
    Ok(Reading {
        place,
        temperature: f.temperature,
        high: f.high,
        low: f.low,
        condition: f.condition,
        is_day: f.is_day,
    })
}

fn publish(tx: &watch::Sender<WeatherState>, units: Units, result: Result<Reading, Failure>) {
    match result {
        Ok(reading) => {
            tx.send_replace(WeatherState {
                status: Status::Ready,
                units,
                reading: Some(reading),
            });
        }
        Err(failure) => {
            match failure {
                Failure::NotFound(name) => tracing::warn!("Open-Meteo knows no place {name:?}"),
                Failure::Fetch(err) => tracing::warn!("no weather: {err:#}"),
            }
            tx.send_modify(|s| {
                s.units = units;
                if s.reading.is_none() {
                    s.status = Status::Error;
                }
            });
        }
    }
}
