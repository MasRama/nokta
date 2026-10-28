//! `io.nokta.Weather1` at `/io/nokta/Weather`.

use tokio::sync::{mpsc, watch};
use zbus::Connection;

use super::service::Handle;
use super::WeatherState;
use crate::shared::dbus::{owned, spawn_change_forwarder, PropertyList};

pub const PATH: &str = "/io/nokta/Weather";
pub const INTERFACE: &str = "io.nokta.Weather1";

pub async fn serve(conn: &Connection, handle: Handle) -> zbus::Result<()> {
    let Handle { refresh, state } = handle;
    conn.object_server()
        .at(
            PATH,
            WeatherInterface {
                refresh,
                state: state.clone(),
            },
        )
        .await?;
    spawn_change_forwarder(conn.clone(), PATH, INTERFACE, state, properties);
    Ok(())
}

/// The reading's fields, or empty values when there is none.
fn fields(s: &WeatherState) -> (String, f64, f64, f64, &'static str, bool) {
    match &s.reading {
        Some(r) => (
            r.place.clone(),
            r.temperature,
            r.high,
            r.low,
            r.condition.as_str(),
            r.is_day,
        ),
        None => (String::new(), 0.0, 0.0, 0.0, "", false),
    }
}

fn properties(s: &WeatherState) -> PropertyList {
    let (place, temperature, high, low, condition, is_day) = fields(s);
    vec![
        ("Status", owned(s.status.as_str())),
        ("Place", owned(place)),
        ("Temperature", owned(temperature)),
        ("High", owned(high)),
        ("Low", owned(low)),
        ("Units", owned(s.units.as_str())),
        ("Condition", owned(condition)),
        ("IsDay", owned(is_day)),
    ]
}

struct WeatherInterface {
    refresh: mpsc::Sender<()>,
    state: watch::Receiver<WeatherState>,
}

#[zbus::interface(name = "io.nokta.Weather1")]
impl WeatherInterface {
    /// Asks Open-Meteo again if the reading is stale; returns at once.
    fn refresh(&self) {
        // A full queue already holds a refresh.
        let _ = self.refresh.try_send(());
    }

    #[zbus(property)]
    fn status(&self) -> String {
        self.state.borrow().status.as_str().to_owned()
    }

    #[zbus(property)]
    fn place(&self) -> String {
        fields(&self.state.borrow()).0
    }

    #[zbus(property)]
    fn temperature(&self) -> f64 {
        fields(&self.state.borrow()).1
    }

    #[zbus(property)]
    fn high(&self) -> f64 {
        fields(&self.state.borrow()).2
    }

    #[zbus(property)]
    fn low(&self) -> f64 {
        fields(&self.state.borrow()).3
    }

    #[zbus(property)]
    fn units(&self) -> String {
        self.state.borrow().units.as_str().to_owned()
    }

    #[zbus(property)]
    fn condition(&self) -> String {
        fields(&self.state.borrow()).4.to_owned()
    }

    #[zbus(property)]
    fn is_day(&self) -> bool {
        fields(&self.state.borrow()).5
    }
}
