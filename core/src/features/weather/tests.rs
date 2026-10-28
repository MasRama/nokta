use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::BoxFuture;
use tokio::sync::watch;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::model::{
    is_due, Attempt, Condition, Coordinates, Forecast, Location, Units, FAILURE_FRESH_US,
    READING_FRESH_US,
};
use super::openmeteo::{Client, FetchError, Place};
use super::service::{self, WeatherSource};
use super::{Status, WeatherState};
use crate::features::settings::WeatherConfig;

#[test]
fn wmo_codes_map_to_conditions() {
    let cases = [
        (0, Condition::Clear),
        (1, Condition::PartlyCloudy),
        (2, Condition::PartlyCloudy),
        (3, Condition::Cloudy),
        (45, Condition::Fog),
        (48, Condition::Fog),
        (51, Condition::Drizzle),
        (57, Condition::Drizzle),
        (61, Condition::Rain),
        (67, Condition::Rain),
        (71, Condition::Snow),
        (77, Condition::Snow),
        (85, Condition::Snow),
        (86, Condition::Snow),
        (80, Condition::Showers),
        (82, Condition::Showers),
        (95, Condition::Thunderstorm),
        (99, Condition::Thunderstorm),
        (4, Condition::Unknown),
        (100, Condition::Unknown),
    ];
    for (code, condition) in cases {
        assert_eq!(Condition::from_wmo(code), condition, "code {code}");
    }
    assert_eq!(Condition::PartlyCloudy.as_str(), "partly-cloudy");
    assert_eq!(Condition::Thunderstorm.as_str(), "thunderstorm");
}

#[test]
fn a_location_is_coordinates_or_a_place_name() {
    assert_eq!(
        Location::parse("-6.2,106.8"),
        Some(Location::At(Coordinates {
            latitude: -6.2,
            longitude: 106.8
        }))
    );
    assert_eq!(
        Location::parse(" 51.5 , -0.12 "),
        Some(Location::At(Coordinates {
            latitude: 51.5,
            longitude: -0.12
        }))
    );
    assert_eq!(
        Location::parse("  Jakarta "),
        Some(Location::Named("Jakarta".into()))
    );
    // Out of range numbers are not coordinates, so they are looked up as text.
    assert_eq!(
        Location::parse("95,200"),
        Some(Location::Named("95,200".into()))
    );
    assert_eq!(Location::parse("   "), None);
}

#[test]
fn units_follow_the_config_value() {
    assert_eq!(Units::from_config("fahrenheit"), Units::Fahrenheit);
    assert_eq!(Units::from_config("celsius"), Units::Celsius);
    assert_eq!(Units::Fahrenheit.as_str(), "fahrenheit");
}

#[test]
fn a_reading_stays_fresh_longer_than_a_failure() {
    assert!(is_due(None, 0));
    let ok = Attempt {
        at_us: 1_000,
        ok: true,
    };
    assert!(!is_due(Some(ok), 1_000 + READING_FRESH_US - 1));
    assert!(is_due(Some(ok), 1_000 + READING_FRESH_US));
    let failed = Attempt {
        at_us: 1_000,
        ok: false,
    };
    assert!(!is_due(Some(failed), 1_000 + FAILURE_FRESH_US - 1));
    assert!(is_due(Some(failed), 1_000 + FAILURE_FRESH_US));
    assert_eq!(READING_FRESH_US, 30 * 60 * 1_000_000);
    assert_eq!(FAILURE_FRESH_US, 5 * 60 * 1_000_000);
}

const FORECAST: &str = r#"{
    "current": {"temperature_2m": 31.2, "weather_code": 2, "is_day": 1},
    "daily": {"temperature_2m_max": [33.4], "temperature_2m_min": [25.1]}
}"#;

#[tokio::test]
async fn the_client_reads_the_forecast() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/forecast"))
        .and(query_param("latitude", "-6.2"))
        .and(query_param("longitude", "106.8"))
        .and(query_param("current", "temperature_2m,weather_code,is_day"))
        .and(query_param(
            "daily",
            "temperature_2m_max,temperature_2m_min",
        ))
        .and(query_param("timezone", "auto"))
        .and(query_param("forecast_days", "1"))
        .and(query_param("temperature_unit", "fahrenheit"))
        .respond_with(ResponseTemplate::new(200).set_body_string(FORECAST))
        .mount(&server)
        .await;
    let client = Client::new(&server.uri(), &server.uri(), "test");
    let at = Coordinates {
        latitude: -6.2,
        longitude: 106.8,
    };
    let forecast = client.forecast(at, Units::Fahrenheit).await.unwrap();
    assert_eq!(
        forecast,
        Forecast {
            temperature: 31.2,
            high: 33.4,
            low: 25.1,
            condition: Condition::PartlyCloudy,
            is_day: true,
        }
    );
}

#[tokio::test]
async fn the_client_finds_a_place() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/search"))
        .and(query_param("name", "Jakarta"))
        .and(query_param("count", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_string(
            r#"{"results": [{"name": "Jakarta", "latitude": -6.2, "longitude": 106.8}]}"#,
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/search"))
        .and(query_param("name", "Nowhere"))
        .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"generationtime_ms": 0.1}"#))
        .mount(&server)
        .await;
    let client = Client::new(&server.uri(), &server.uri(), "test");
    assert_eq!(
        client.locate("Jakarta").await.unwrap(),
        Some(Place {
            name: "Jakarta".into(),
            at: Coordinates {
                latitude: -6.2,
                longitude: 106.8
            },
        })
    );
    assert_eq!(client.locate("Nowhere").await.unwrap(), None);
}

#[tokio::test]
async fn the_client_reports_a_server_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let client = Client::new(&server.uri(), &server.uri(), "test");
    let at = Coordinates {
        latitude: 0.0,
        longitude: 0.0,
    };
    assert!(matches!(
        client.forecast(at, Units::Celsius).await,
        Err(FetchError::Status(_))
    ));
}

/// A source whose answers the test changes, counting the requests it gets.
#[derive(Default)]
struct FakeSource {
    fail: Mutex<bool>,
    temperature: Mutex<f64>,
    forecasts: AtomicUsize,
    locates: AtomicUsize,
    last_units: Mutex<Option<Units>>,
}

impl WeatherSource for FakeSource {
    fn locate<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<Place>, FetchError>> {
        Box::pin(async move {
            self.locates.fetch_add(1, Ordering::SeqCst);
            Ok((name != "Nowhere").then(|| Place {
                name: format!("{name} City"),
                at: Coordinates {
                    latitude: 1.0,
                    longitude: 2.0,
                },
            }))
        })
    }

    fn forecast(
        &self,
        _at: Coordinates,
        units: Units,
    ) -> BoxFuture<'_, Result<Forecast, FetchError>> {
        Box::pin(async move {
            self.forecasts.fetch_add(1, Ordering::SeqCst);
            *self.last_units.lock().unwrap() = Some(units);
            if *self.fail.lock().unwrap() {
                return Err(FetchError::Status(reqwest::StatusCode::BAD_GATEWAY));
            }
            Ok(Forecast {
                temperature: *self.temperature.lock().unwrap(),
                high: 30.0,
                low: 20.0,
                condition: Condition::Rain,
                is_day: false,
            })
        })
    }
}

struct Rig {
    config: watch::Sender<WeatherConfig>,
    source: Arc<FakeSource>,
    clock: Arc<AtomicI64>,
    handle: service::Handle,
}

fn config(location: &str) -> WeatherConfig {
    WeatherConfig {
        location: location.into(),
        ..WeatherConfig::default()
    }
}

fn rig(initial: WeatherConfig) -> Rig {
    let (tx, rx) = watch::channel(initial);
    let source = Arc::new(FakeSource::default());
    *source.temperature.lock().unwrap() = 27.5;
    let clock = Arc::new(AtomicI64::new(1));
    let now = {
        let clock = clock.clone();
        move || clock.load(Ordering::SeqCst)
    };
    let handle = service::spawn(rx, source.clone(), now);
    Rig {
        config: tx,
        source,
        clock,
        handle,
    }
}

/// Waits until the state matches, or fails with the last state seen.
async fn wait_state(rig: &Rig, check: impl Fn(&WeatherState) -> bool) -> WeatherState {
    let mut state = rig.handle.state.clone();
    let found = tokio::time::timeout(Duration::from_secs(2), state.wait_for(|s| check(s))).await;
    match found {
        Ok(Ok(s)) => s.clone(),
        _ => panic!("state never matched: {:?}", rig.handle.state.borrow()),
    }
}

/// Lets the service act on what it was just sent.
async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn no_location_means_no_weather_and_no_requests() {
    let rig = rig(config(""));
    settle().await;
    assert_eq!(rig.handle.state.borrow().status, Status::Off);
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 0);
    assert_eq!(rig.source.locates.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_place_is_looked_up_then_its_weather_is_published() {
    let rig = rig(config("Jakarta"));
    let state = wait_state(&rig, |s| s.status == Status::Ready).await;
    let reading = state.reading.unwrap();
    assert_eq!(reading.place, "Jakarta City");
    assert_eq!(reading.temperature, 27.5);
    assert_eq!(reading.high, 30.0);
    assert_eq!(reading.low, 20.0);
    assert_eq!(reading.condition, Condition::Rain);
    assert!(!reading.is_day);
    assert_eq!(state.units, Units::Celsius);
}

#[tokio::test]
async fn coordinates_skip_the_place_lookup() {
    let rig = rig(config("-6.2,106.8"));
    let state = wait_state(&rig, |s| s.status == Status::Ready).await;
    assert_eq!(state.reading.unwrap().place, "");
    assert_eq!(rig.source.locates.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_unknown_place_is_an_error() {
    let rig = rig(config("Nowhere"));
    let state = wait_state(&rig, |s| s.status == Status::Error).await;
    assert_eq!(state.reading, None);
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn refresh_asks_again_only_when_the_reading_is_stale() {
    let rig = rig(config("Jakarta"));
    wait_state(&rig, |s| s.status == Status::Ready).await;
    rig.handle.refresh.send(()).await.unwrap();
    settle().await;
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 1);

    *rig.source.temperature.lock().unwrap() = 29.0;
    rig.clock.fetch_add(READING_FRESH_US, Ordering::SeqCst);
    rig.handle.refresh.send(()).await.unwrap();
    wait_state(&rig, |s| {
        s.reading.as_ref().is_some_and(|r| r.temperature == 29.0)
    })
    .await;
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 2);
    // The place was found once; the service remembers it.
    assert_eq!(rig.source.locates.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_failed_refresh_keeps_the_last_reading() {
    let rig = rig(config("Jakarta"));
    wait_state(&rig, |s| s.status == Status::Ready).await;
    *rig.source.fail.lock().unwrap() = true;
    rig.clock.fetch_add(READING_FRESH_US, Ordering::SeqCst);
    rig.handle.refresh.send(()).await.unwrap();
    settle().await;
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 2);
    let state = rig.handle.state.borrow().clone();
    assert_eq!(state.status, Status::Ready);
    assert_eq!(state.reading.unwrap().temperature, 27.5);

    // A failure is retried after five minutes, not thirty.
    rig.handle.refresh.send(()).await.unwrap();
    settle().await;
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 2);
    rig.clock.fetch_add(FAILURE_FRESH_US, Ordering::SeqCst);
    rig.handle.refresh.send(()).await.unwrap();
    settle().await;
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_new_location_or_unit_asks_straight_away() {
    let rig = rig(config("Jakarta"));
    wait_state(&rig, |s| s.status == Status::Ready).await;

    rig.config.send_modify(|c| c.location = "Bandung".into());
    wait_state(&rig, |s| {
        s.reading
            .as_ref()
            .is_some_and(|r| r.place == "Bandung City")
    })
    .await;

    rig.config.send_modify(|c| c.units = "fahrenheit".into());
    wait_state(&rig, |s| {
        s.units == Units::Fahrenheit && s.status == Status::Ready
    })
    .await;
    assert_eq!(
        *rig.source.last_units.lock().unwrap(),
        Some(Units::Fahrenheit)
    );
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn turning_weather_off_clears_it() {
    let rig = rig(config("Jakarta"));
    wait_state(&rig, |s| s.status == Status::Ready).await;
    rig.config.send_modify(|c| c.enabled = false);
    let state = wait_state(&rig, |s| s.status == Status::Off).await;
    assert_eq!(state.reading, None);
    rig.handle.refresh.send(()).await.unwrap();
    settle().await;
    assert_eq!(rig.source.forecasts.load(Ordering::SeqCst), 1);
}
