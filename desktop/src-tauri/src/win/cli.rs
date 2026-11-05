//! The `nokta` command's way in: this user's named pipe, one JSON line each
//! way (`nokta_core::cli::pipe`). Windows' default rights on a pipe let
//! only its owner, SYSTEM and admins write to it.

use std::io;

use nokta_core::cli::pipe::{self, Answer, Request, MAX_LINE};
use nokta_core::features::activities::model::Update;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

use super::services::Core;

/// Listens on the pipe for as long as the app runs.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = listen(app).await {
            tracing::warn!("the nokta command cannot reach the app: {err}");
        }
    });
}

async fn listen(app: AppHandle) -> io::Result<()> {
    let name = pipe::name(&pipe::user_sid()?);
    // The first end fails if another program already holds the name.
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&name)?;
    loop {
        server.connect().await?;
        // A new end waits for the next caller while this one talks.
        let caller = std::mem::replace(&mut server, ServerOptions::new().create(&name)?);
        tauri::async_runtime::spawn(talk(caller, app.clone()));
    }
}

/// Answers a caller's requests until it hangs up.
async fn talk(pipe: NamedPipeServer, app: AppHandle) {
    let (read, mut write) = tokio::io::split(pipe);
    let mut read = BufReader::new(read);
    let mut line = String::new();
    loop {
        line.clear();
        match (&mut read).take(MAX_LINE).read_line(&mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let answer = match serde_json::from_str::<Request>(line.trim_end()) {
            Ok(request) => Answer::from_result(answer(&app, request).await),
            Err(err) => Answer::from_result(Err(format!("Nokta does not know this call: {err}"))),
        };
        if write
            .write_all(pipe::line(&answer).as_bytes())
            .await
            .is_err()
        {
            return;
        }
    }
}

async fn answer(app: &AppHandle, request: Request) -> Result<Value, String> {
    let core = app.state::<Core>();
    let done = |result: Result<(), String>| result.map(|()| Value::Null);
    match request {
        Request::ActivitySet {
            id,
            title,
            detail,
            icon,
            progress,
        } => {
            let update = Update {
                title,
                detail,
                icon,
                progress,
            };
            done(core.set_activity(id, update).await)
        }
        Request::ActivityEnd {
            id,
            success,
            message,
        } => done(core.end_activity(id, success, message).await),
        // The clock's id is for the page; nokta does not need it.
        Request::AddCountdown { label, duration_us } => {
            let args = [json!(label), json!(duration_us)];
            core.timer("AddCountdown", &args).await.map(|_| Value::Null)
        }
        Request::AddStopwatch { label } => core
            .timer("AddStopwatch", &[json!(label)])
            .await
            .map(|_| Value::Null),
        Request::AddAlarm { label, unix_us } => {
            let args = [json!(label), json!(unix_us)];
            core.timer("AddAlarm", &args).await.map(|_| Value::Null)
        }
        Request::ClearClocks => core.timer("ClearClocks", &[]).await.map(|_| Value::Null),
        Request::Settings => done(super::settings_window::open(app).map_err(|err| err.to_string())),
        Request::PluginList => Ok(core.plugin_rows()),
        Request::PluginInstall { path } => core.plugins("Install", &[json!(path)]).await,
        Request::PluginRemove { id } => core.plugins("Remove", &[json!(id)]).await,
        Request::PluginEnable { id, enabled } => {
            core.plugins("SetEnabled", &[json!(id), json!(enabled)])
                .await
        }
        Request::PluginRun { id, action } => core.plugins("Run", &[json!(id), json!(action)]).await,
    }
}
