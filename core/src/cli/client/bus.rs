//! Talks to `io.nokta.Activities1` and `io.nokta.Timer1` on the session bus.

use zbus::Connection;

use super::CallError;

const BUS_NAME: &str = "io.nokta.Nokta";
const PATH: &str = "/io/nokta/Activities";
const INTERFACE: &str = "io.nokta.Activities1";
const TIMER_PATH: &str = "/io/nokta/Timer";
const TIMER_INTERFACE: &str = "io.nokta.Timer1";

/// What the errors say Nokta is.
pub const NAME: &str = "noktad";

pub struct Client {
    activities: zbus::Proxy<'static>,
    timer: zbus::Proxy<'static>,
}

impl From<zbus::Error> for CallError {
    fn from(err: zbus::Error) -> CallError {
        match err {
            zbus::Error::MethodError(_, Some(message), _) => CallError::Refused(message),
            err => CallError::Unreachable(err.to_string()),
        }
    }
}

impl Client {
    pub async fn connect() -> Result<Client, CallError> {
        let conn = Connection::session().await?;
        let activities = zbus::Proxy::new(&conn, BUS_NAME, PATH, INTERFACE).await?;
        let timer = zbus::Proxy::new(&conn, BUS_NAME, TIMER_PATH, TIMER_INTERFACE).await?;
        Ok(Client { activities, timer })
    }

    pub async fn set(
        &self,
        id: &str,
        title: &str,
        detail: &str,
        icon: &str,
        progress: f64,
    ) -> Result<(), CallError> {
        Ok(self
            .activities
            .call("Set", &(id, title, detail, icon, progress))
            .await?)
    }

    pub async fn end(&self, id: &str, success: bool, message: &str) -> Result<(), CallError> {
        Ok(self.activities.call("End", &(id, success, message)).await?)
    }

    pub async fn add_countdown(&self, label: &str, duration_us: i64) -> Result<(), CallError> {
        self.add("AddCountdown", &(label, duration_us)).await
    }

    pub async fn add_stopwatch(&self, label: &str) -> Result<(), CallError> {
        self.add("AddStopwatch", &(label,)).await
    }

    pub async fn add_alarm(&self, label: &str, unix_us: i64) -> Result<(), CallError> {
        self.add("AddAlarm", &(label, unix_us)).await
    }

    pub async fn clear_clocks(&self) -> Result<(), CallError> {
        Ok(self.timer.call("ClearClocks", &()).await?)
    }

    /// The timer answers an add with the clock's id, which nokta does not need.
    async fn add<B>(&self, method: &str, body: &B) -> Result<(), CallError>
    where
        B: serde::Serialize + zbus::zvariant::DynamicType,
    {
        self.timer
            .call::<_, _, String>(method, body)
            .await
            .map(drop)
            .map_err(CallError::from)
    }
}
