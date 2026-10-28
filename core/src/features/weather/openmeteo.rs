//! Client for the Open-Meteo forecast and geocoding APIs. Neither needs a key.

use std::time::Duration;

use serde::Deserialize;

use super::model::{Condition, Coordinates, Forecast, Units};
use crate::shared::http;

pub const DEFAULT_FORECAST_URL: &str = "https://api.open-meteo.com";
pub const DEFAULT_GEOCODING_URL: &str = "https://geocoding-api.open-meteo.com";
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error("request to Open-Meteo failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Open-Meteo answered with status {0}")]
    Status(reqwest::StatusCode),
    #[error("Open-Meteo sent no forecast for today")]
    NoForecast,
}

/// A place the geocoding API found.
#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    pub name: String,
    pub at: Coordinates,
}

#[derive(Deserialize)]
struct Search {
    #[serde(default)]
    results: Vec<SearchResult>,
}

#[derive(Deserialize)]
struct SearchResult {
    name: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Deserialize)]
struct Response {
    current: Current,
    daily: Daily,
}

#[derive(Deserialize)]
struct Current {
    temperature_2m: f64,
    weather_code: u32,
    is_day: u8,
}

#[derive(Deserialize)]
struct Daily {
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

#[derive(Clone, Debug)]
pub struct Client {
    http: reqwest::Client,
    forecast_url: String,
    geocoding_url: String,
}

impl Client {
    pub fn new(forecast_url: &str, geocoding_url: &str, user_agent: &str) -> Client {
        Client {
            http: http::client(|b| b.user_agent(user_agent).timeout(TIMEOUT)),
            forecast_url: forecast_url.trim_end_matches('/').to_owned(),
            geocoding_url: geocoding_url.trim_end_matches('/').to_owned(),
        }
    }

    /// The best match for `name`, or `None` when Open-Meteo knows no such place.
    pub async fn locate(&self, name: &str) -> Result<Option<Place>, FetchError> {
        let resp = self
            .http
            .get(format!("{}/v1/search", self.geocoding_url))
            .query(&[("name", name), ("count", "1")])
            .send()
            .await?;
        let search: Search = checked(resp)?.json().await?;
        Ok(search.results.into_iter().next().map(|r| Place {
            name: r.name,
            at: Coordinates {
                latitude: r.latitude,
                longitude: r.longitude,
            },
        }))
    }

    pub async fn forecast(&self, at: Coordinates, units: Units) -> Result<Forecast, FetchError> {
        let (latitude, longitude) = (at.latitude.to_string(), at.longitude.to_string());
        let resp = self
            .http
            .get(format!("{}/v1/forecast", self.forecast_url))
            .query(&[
                ("latitude", latitude.as_str()),
                ("longitude", longitude.as_str()),
                ("current", "temperature_2m,weather_code,is_day"),
                ("daily", "temperature_2m_max,temperature_2m_min"),
                ("timezone", "auto"),
                ("forecast_days", "1"),
                ("temperature_unit", units.as_str()),
            ])
            .send()
            .await?;
        let body: Response = checked(resp)?.json().await?;
        let (Some(&high), Some(&low)) = (
            body.daily.temperature_2m_max.first(),
            body.daily.temperature_2m_min.first(),
        ) else {
            return Err(FetchError::NoForecast);
        };
        Ok(Forecast {
            temperature: body.current.temperature_2m,
            high,
            low,
            condition: Condition::from_wmo(body.current.weather_code),
            is_day: body.current.is_day != 0,
        })
    }
}

fn checked(resp: reqwest::Response) -> Result<reqwest::Response, FetchError> {
    let status = resp.status();
    if status.is_success() {
        Ok(resp)
    } else {
        Err(FetchError::Status(status))
    }
}
