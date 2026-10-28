//! Pure weather rules: what a location string means, what a WMO weather code
//! looks like and when a reading is old enough to ask again.

/// A reading is good for this long.
pub const READING_FRESH_US: i64 = 30 * 60 * 1_000_000;
/// After a failure, wait this long before asking again.
pub const FAILURE_FRESH_US: i64 = 5 * 60 * 1_000_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Units {
    #[default]
    Celsius,
    Fahrenheit,
}

impl Units {
    /// `weather.units` is validated, so anything but "fahrenheit" is celsius.
    pub fn from_config(value: &str) -> Units {
        match value {
            "fahrenheit" => Units::Fahrenheit,
            _ => Units::Celsius,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Units::Celsius => "celsius",
            Units::Fahrenheit => "fahrenheit",
        }
    }
}

/// The sky, grouped from WMO weather codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Condition {
    Clear,
    PartlyCloudy,
    Cloudy,
    Fog,
    Drizzle,
    Rain,
    Snow,
    Showers,
    Thunderstorm,
    Unknown,
}

impl Condition {
    pub fn from_wmo(code: u32) -> Condition {
        match code {
            0 => Condition::Clear,
            1 | 2 => Condition::PartlyCloudy,
            3 => Condition::Cloudy,
            45 | 48 => Condition::Fog,
            51..=57 => Condition::Drizzle,
            61..=67 => Condition::Rain,
            71..=77 | 85 | 86 => Condition::Snow,
            80..=82 => Condition::Showers,
            95..=99 => Condition::Thunderstorm,
            _ => Condition::Unknown,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Condition::Clear => "clear",
            Condition::PartlyCloudy => "partly-cloudy",
            Condition::Cloudy => "cloudy",
            Condition::Fog => "fog",
            Condition::Drizzle => "drizzle",
            Condition::Rain => "rain",
            Condition::Snow => "snow",
            Condition::Showers => "showers",
            Condition::Thunderstorm => "thunderstorm",
            Condition::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Coordinates {
    pub latitude: f64,
    pub longitude: f64,
}

/// What `weather.location` names.
#[derive(Clone, Debug, PartialEq)]
pub enum Location {
    /// `latitude,longitude`, such as `-6.2,106.8`.
    At(Coordinates),
    /// A place to look up by name.
    Named(String),
}

impl Location {
    /// `None` for an empty location.
    pub fn parse(text: &str) -> Option<Location> {
        let text = text.trim();
        if text.is_empty() {
            return None;
        }
        let coordinates = text.split_once(',').and_then(|(lat, lon)| {
            let latitude: f64 = lat.trim().parse().ok()?;
            let longitude: f64 = lon.trim().parse().ok()?;
            ((-90.0..=90.0).contains(&latitude) && (-180.0..=180.0).contains(&longitude)).then_some(
                Coordinates {
                    latitude,
                    longitude,
                },
            )
        });
        Some(match coordinates {
            Some(at) => Location::At(at),
            None => Location::Named(text.to_owned()),
        })
    }
}

/// The weather Open-Meteo reports for a spot.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Forecast {
    pub temperature: f64,
    pub high: f64,
    pub low: f64,
    pub condition: Condition,
    pub is_day: bool,
}

/// The last request and whether it worked, on the monotonic clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Attempt {
    pub at_us: i64,
    pub ok: bool,
}

/// Whether to ask again at `now_us`.
pub fn is_due(last: Option<Attempt>, now_us: i64) -> bool {
    match last {
        None => true,
        Some(a) => {
            let fresh = if a.ok {
                READING_FRESH_US
            } else {
                FAILURE_FRESH_US
            };
            now_us - a.at_us >= fresh
        }
    }
}
