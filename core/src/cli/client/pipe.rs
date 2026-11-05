//! Talks to the Windows app over this user's named pipe.

use std::io;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::sync::Mutex;

use super::{CallError, PluginRow};
use crate::cli::pipe::{self, Answer, Request, MAX_LINE};

/// What the errors say Nokta is.
pub const NAME: &str = "Nokta";

/// How long to wait for a free end of the pipe while others talk to the app.
const BUSY_TRIES: u32 = 50;
const BUSY_WAIT: Duration = Duration::from_millis(20);

pub struct Client {
    pipe: Mutex<BufReader<NamedPipeClient>>,
}

impl From<io::Error> for CallError {
    fn from(err: io::Error) -> CallError {
        CallError::Unreachable(err.to_string())
    }
}

impl Client {
    pub async fn connect() -> Result<Client, CallError> {
        let name = pipe::name(&pipe::user_sid()?);
        let pipe = open(&name).await.map_err(|err| match err.kind() {
            io::ErrorKind::NotFound => CallError::Unreachable("it is not running".into()),
            _ => CallError::from(err),
        })?;
        Ok(Client {
            pipe: Mutex::new(BufReader::new(pipe)),
        })
    }

    pub async fn set(
        &self,
        id: &str,
        title: &str,
        detail: &str,
        icon: &str,
        progress: f64,
    ) -> Result<(), CallError> {
        self.call(Request::ActivitySet {
            id: id.into(),
            title: title.into(),
            detail: detail.into(),
            icon: icon.into(),
            progress,
        })
        .await
    }

    pub async fn end(&self, id: &str, success: bool, message: &str) -> Result<(), CallError> {
        self.call(Request::ActivityEnd {
            id: id.into(),
            success,
            message: message.into(),
        })
        .await
    }

    pub async fn add_countdown(&self, label: &str, duration_us: i64) -> Result<(), CallError> {
        self.call(Request::AddCountdown {
            label: label.into(),
            duration_us,
        })
        .await
    }

    pub async fn add_stopwatch(&self, label: &str) -> Result<(), CallError> {
        self.call(Request::AddStopwatch {
            label: label.into(),
        })
        .await
    }

    pub async fn add_alarm(&self, label: &str, unix_us: i64) -> Result<(), CallError> {
        self.call(Request::AddAlarm {
            label: label.into(),
            unix_us,
        })
        .await
    }

    pub async fn clear_clocks(&self) -> Result<(), CallError> {
        self.call(Request::ClearClocks).await
    }

    pub async fn open_settings(&self) -> Result<(), CallError> {
        self.call(Request::Settings).await
    }

    pub async fn plugin_list(&self) -> Result<Vec<PluginRow>, CallError> {
        let value = self.ask(Request::PluginList).await?;
        serde_json::from_value(value.unwrap_or_default())
            .map_err(|err| CallError::Unreachable(format!("its list does not read: {err}")))
    }

    /// Answers the new plugin's id.
    pub async fn plugin_install(&self, path: &str) -> Result<String, CallError> {
        match self
            .ask(Request::PluginInstall { path: path.into() })
            .await?
        {
            Some(serde_json::Value::String(id)) => Ok(id),
            _ => Err(CallError::Unreachable(
                "it did not say the plugin's id".into(),
            )),
        }
    }

    pub async fn plugin_remove(&self, id: &str) -> Result<(), CallError> {
        self.call(Request::PluginRemove { id: id.into() }).await
    }

    pub async fn plugin_enable(&self, id: &str, enabled: bool) -> Result<(), CallError> {
        self.call(Request::PluginEnable {
            id: id.into(),
            enabled,
        })
        .await
    }

    pub async fn plugin_run(&self, id: &str, action: &str) -> Result<(), CallError> {
        self.call(Request::PluginRun {
            id: id.into(),
            action: action.into(),
        })
        .await
    }

    async fn call(&self, request: Request) -> Result<(), CallError> {
        self.ask(request).await.map(drop)
    }

    /// Sends `request`; answers what the app answered with, if anything.
    async fn ask(&self, request: Request) -> Result<Option<serde_json::Value>, CallError> {
        let mut pipe = self.pipe.lock().await;
        pipe.get_mut()
            .write_all(pipe::line(&request).as_bytes())
            .await?;
        let mut line = String::new();
        let read = (&mut *pipe).take(MAX_LINE).read_line(&mut line).await?;
        if read == 0 {
            return Err(CallError::Unreachable("it closed the pipe".into()));
        }
        let answer: Answer = serde_json::from_str(line.trim_end())
            .map_err(|err| CallError::Unreachable(format!("its answer does not read: {err}")))?;
        match answer.error {
            Some(message) => Err(CallError::Refused(message)),
            None => Ok(answer.value),
        }
    }
}

/// Opens the pipe, waiting while every end of it is busy with others.
async fn open(name: &str) -> io::Result<NamedPipeClient> {
    use windows::Win32::Foundation::ERROR_PIPE_BUSY;

    for _ in 0..BUSY_TRIES {
        match ClientOptions::new().open(name) {
            Err(err) if err.raw_os_error() == Some(ERROR_PIPE_BUSY.0 as i32) => {
                tokio::time::sleep(BUSY_WAIT).await;
            }
            opened => return opened,
        }
    }
    ClientOptions::new().open(name)
}
