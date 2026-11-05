//! Runs one plugin's program, out of process, and reads its cards.
//!
//! With `every` above zero the program runs, prints one JSON object and
//! exits, then runs again `every` seconds later or when an action comes.
//! With `every = 0` it keeps running and prints one object per line; actions
//! reach it as `{"action":"name"}` lines on its standard input, and it is
//! started again, waiting longer each time, when it exits.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::card::{self, Card};

/// What a run may print; more is an error.
pub const MAX_OUTPUT: usize = 64 * 1024;
/// What is kept of its error output, for the message.
const MAX_ERRORS: usize = 2 * 1024;
const FIRST_RETRY: Duration = Duration::from_secs(1);
const LAST_RETRY: Duration = Duration::from_secs(300);
/// A stream that ran this long starts again at once.
const STEADY: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub id: String,
    pub dir: PathBuf,
    pub argv: Vec<String>,
    pub every: u32,
    pub timeout: u32,
    /// `NOKTA_OPTION_<KEY>` and the like.
    pub env: Vec<(String, String)>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// A card it printed.
    Card(String, Box<Card>),
    /// It failed: could not start, timed out, exited with an error or printed nonsense.
    Failed(String, String),
}

pub struct Runner {
    /// An action to run with; empty runs it again now.
    pub actions: mpsc::Sender<String>,
    task: JoinHandle<()>,
}

impl Drop for Runner {
    /// Stops the task; its child is killed as it drops.
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub fn spawn(spec: Spec, events: mpsc::Sender<Event>) -> Runner {
    let (actions, requests) = mpsc::channel(8);
    let task = if spec.every == 0 {
        tokio::spawn(stream(spec, requests, events))
    } else {
        tokio::spawn(interval(spec, requests, events))
    };
    Runner { actions, task }
}

/// The program to start: a relative path is the plugin folder's.
fn program(dir: &Path, name: &str) -> PathBuf {
    let path = Path::new(name);
    if path.is_relative() && path.components().count() > 1 {
        dir.join(path)
    } else {
        path.to_owned()
    }
}

fn command(spec: &Spec, action: Option<&str>) -> Command {
    let mut cmd = Command::new(program(&spec.dir, &spec.argv[0]));
    cmd.args(&spec.argv[1..])
        .current_dir(&spec.dir)
        .env("NOKTA_API", super::manifest::API.to_string())
        .env("NOKTA_PLUGIN", &spec.id)
        .env("NOKTA_PLUGIN_DIR", &spec.dir)
        .envs(spec.env.iter().map(|(k, v)| (k, v)))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(action) = action {
        cmd.env("NOKTA_ACTION", action);
    }
    #[cfg(windows)]
    {
        // No console window flashes up for it.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

async fn read_capped(reader: Option<impl AsyncRead + Unpin>, max: usize) -> (Vec<u8>, bool) {
    let Some(reader) = reader else {
        return (Vec::new(), false);
    };
    let mut bytes = Vec::new();
    let mut limited = reader.take(max as u64 + 1);
    let _ = limited.read_to_end(&mut bytes).await;
    let over = bytes.len() > max;
    bytes.truncate(max);
    // Whatever else it prints is read and dropped, so it never blocks on a full pipe.
    let mut rest = limited.into_inner();
    let _ = tokio::io::copy(&mut rest, &mut tokio::io::sink()).await;
    (bytes, over)
}

/// The first line of what it printed on standard error, for a message.
fn first_line(errors: &[u8]) -> String {
    let text = String::from_utf8_lossy(errors);
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(200)
        .collect()
}

/// Runs the program once and reads its card.
pub async fn run_once(spec: &Spec, action: Option<&str>) -> Result<Card, String> {
    let mut child: Child = command(spec, action)
        .stdin(Stdio::null())
        .spawn()
        .map_err(|err| format!("cannot start {}: {err}", spec.argv[0]))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let work = async {
        let ((out, over), (errors, _), status) = tokio::join!(
            read_capped(stdout, MAX_OUTPUT),
            read_capped(stderr, MAX_ERRORS),
            child.wait()
        );
        (out, over, errors, status)
    };
    let (out, over, errors, status) =
        tokio::time::timeout(Duration::from_secs(spec.timeout.into()), work)
            .await
            .map_err(|_| format!("took longer than {} s", spec.timeout))?;
    let status = status.map_err(|err| err.to_string())?;
    if !errors.is_empty() {
        tracing::debug!(plugin = %spec.id, "{}", String::from_utf8_lossy(&errors));
    }
    if !status.success() {
        let why = first_line(&errors);
        let code = status
            .code()
            .map_or_else(|| "a signal".to_owned(), |c| c.to_string());
        return Err(if why.is_empty() {
            format!("exited with {code}")
        } else {
            format!("exited with {code}: {why}")
        });
    }
    if over {
        return Err(format!("printed more than {} KiB", MAX_OUTPUT / 1024));
    }
    card::parse(&String::from_utf8_lossy(&out))
}

async fn report(events: &mpsc::Sender<Event>, id: &str, result: Result<Card, String>) -> bool {
    let event = match result {
        Ok(card) => Event::Card(id.to_owned(), Box::new(card)),
        Err(message) => {
            tracing::info!(plugin = %id, "{message}");
            Event::Failed(id.to_owned(), message)
        }
    };
    events.send(event).await.is_ok()
}

async fn interval(spec: Spec, mut requests: mpsc::Receiver<String>, events: mpsc::Sender<Event>) {
    let mut action: Option<String> = None;
    loop {
        let result = run_once(&spec, action.as_deref()).await;
        if !report(&events, &spec.id, result).await {
            return;
        }
        // Actions that came in during the run are done now; a refresh among them is too.
        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(spec.every.into())) => action = None,
            request = requests.recv() => match request {
                Some(name) => action = (!name.is_empty()).then_some(name),
                None => return,
            },
        }
    }
}

async fn stream(spec: Spec, mut requests: mpsc::Receiver<String>, events: mpsc::Sender<Event>) {
    let mut retry = FIRST_RETRY;
    loop {
        let started = Instant::now();
        let message = match command(&spec, None).stdin(Stdio::piped()).spawn() {
            Ok(mut child) => match follow(&spec, &mut child, &mut requests, &events).await {
                Some(message) => message,
                None => return,
            },
            Err(err) => format!("cannot start {}: {err}", spec.argv[0]),
        };
        if !report(&events, &spec.id, Err(message)).await {
            return;
        }
        if started.elapsed() >= STEADY {
            retry = FIRST_RETRY;
        }
        // Waits, still taking actions so their sender never blocks.
        let wait = tokio::time::sleep(retry);
        tokio::pin!(wait);
        loop {
            tokio::select! {
                () = &mut wait => break,
                request = requests.recv() => if request.is_none() { return },
            }
        }
        retry = (retry * 2).min(LAST_RETRY);
    }
}

/// Reads the child's lines until it exits; returns why it stopped, or none
/// when the plugin was turned off.
async fn follow(
    spec: &Spec,
    child: &mut Child,
    requests: &mut mpsc::Receiver<String>,
    events: &mpsc::Sender<Event>,
) -> Option<String> {
    let mut lines = BufReader::new(child.stdout.take()?).lines();
    let mut stdin = child.stdin.take();
    let errors = child.stderr.take();
    let id = spec.id.clone();
    // Its error output goes to the log as it comes; the last line explains an exit.
    let last_error = tokio::spawn(async move {
        let mut last = String::new();
        if let Some(errors) = errors {
            let mut lines = BufReader::new(errors).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(plugin = %id, "{line}");
                if !line.trim().is_empty() {
                    last = line.trim().chars().take(200).collect();
                }
            }
        }
        last
    });
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(line)) if line.trim().is_empty() => {}
                Ok(Some(line)) if line.len() > MAX_OUTPUT => {
                    report(events, &spec.id, Err(format!("printed a line over {} KiB", MAX_OUTPUT / 1024))).await;
                }
                Ok(Some(line)) => {
                    if !report(events, &spec.id, card::parse(&line)).await {
                        return None;
                    }
                }
                Ok(None) | Err(_) => break,
            },
            request = requests.recv() => match request {
                Some(name) if name.is_empty() => {}
                Some(name) => {
                    if let Some(input) = stdin.as_mut() {
                        let line = format!("{}\n", serde_json::json!({ "action": name }));
                        if input.write_all(line.as_bytes()).await.is_err() || input.flush().await.is_err() {
                            stdin = None;
                        }
                    }
                }
                None => return None,
            },
        }
    }
    let status = child.wait().await;
    let why = last_error.await.unwrap_or_default();
    let code = match status {
        Ok(s) => s
            .code()
            .map_or_else(|| "a signal".to_owned(), |c| c.to_string()),
        Err(err) => err.to_string(),
    };
    Some(if why.is_empty() {
        format!("stopped with {code}")
    } else {
        format!("stopped with {code}: {why}")
    })
}
