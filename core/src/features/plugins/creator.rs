//! Creator Mode: a plugin written by a language model from one sentence.
//!
//! The user brings their own key, for Anthropic's Messages API or any
//! OpenAI-compatible chat API, kept in `creator.toml` next to `config.toml`
//! and readable only by them. The model gets the plugin contract
//! (`docs/plugins.md`) and answers with the plugin's files as JSON. Nokta
//! checks them as it checks a catalog plugin, never overwrites a plugin
//! the user has, and installs it off: nothing it wrote runs until the user
//! has read it and turned it on.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::catalog::valid_path;
use super::install;
use super::manifest;
use super::service::{self, Command};
use crate::shared::http;

pub const ANTHROPIC_URL: &str = "https://api.anthropic.com";
pub const ANTHROPIC_MODEL: &str = "claude-opus-5-5";
const ANTHROPIC_VERSION: &str = "2026-10-21";
/// Models that take `fallbacks: "default"`: a request their safety
/// classifiers decline is run again on Anthropic's recommended model.
const FALLBACK_MODELS: &[&str] = &[
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-fable-5-1",
    "claude-sonnet-5-5",
];
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
/// Writing a plugin takes the model a while; thinking included.
const TIMEOUT: Duration = Duration::from_secs(300);
const MAX_TOKENS: u32 = 16_000;
/// What a written plugin may be: a few small text files.
const MAX_FILES: usize = 12;
const MAX_FILE_BYTES: usize = 64 * 1024;
/// The sentence, in characters.
pub const MAX_REQUEST: usize = 1000;
const CONTRACT: &str = include_str!("../../../../docs/plugins.md");

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    #[default]
    Anthropic,
    /// Any API with OpenAI's `/chat/completions`.
    Openai,
}

impl Provider {
    pub fn parse(text: &str) -> Result<Provider, String> {
        match text {
            "anthropic" => Ok(Provider::Anthropic),
            "openai" => Ok(Provider::Openai),
            other => Err(format!("{other:?} is not a provider: anthropic or openai")),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
        }
    }
}

/// `creator.toml`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub provider: Provider,
    /// Empty is the provider's default; an OpenAI-compatible API has none.
    pub model: String,
    /// Empty is Anthropic's own API; an OpenAI-compatible API needs one,
    /// up to its `/v1`.
    pub base_url: String,
    pub api_key: String,
}

impl Settings {
    /// Missing or broken reads as not set up.
    pub fn load(path: &Path) -> Settings {
        let Ok(text) = std::fs::read_to_string(path) else {
            return Settings::default();
        };
        toml::from_str(&text).unwrap_or_else(|err| {
            tracing::warn!(
                "{} is broken, so Creator Mode is off: {err}",
                path.display()
            );
            Settings::default()
        })
    }

    /// Writes it readable by this user only.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let text = format!(
            "# Creator Mode: the AI service that writes plugins. Keep this file\n\
             # private; it holds your API key.\n{}",
            toml::to_string(self).map_err(|err| err.to_string())?
        );
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
        }
        let tmp = path.with_extension("toml.tmp");
        let _ = std::fs::remove_file(&tmp);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|err| format!("cannot write {}: {err}", tmp.display()))?;
        std::io::Write::write_all(&mut file, text.as_bytes()).map_err(|err| err.to_string())?;
        drop(file);
        std::fs::rename(&tmp, path).map_err(|err| format!("cannot write {}: {err}", path.display()))
    }

    pub fn model(&self) -> &str {
        match (self.model.trim(), self.provider) {
            ("", Provider::Anthropic) => ANTHROPIC_MODEL,
            (model, _) => model,
        }
    }

    fn base_url(&self) -> &str {
        match (self.base_url.trim(), self.provider) {
            ("", Provider::Anthropic) => ANTHROPIC_URL,
            (url, _) => url.trim_end_matches('/'),
        }
    }

    /// Why it cannot write a plugin yet, if it cannot.
    pub fn missing(&self) -> Option<&'static str> {
        if self.api_key.trim().is_empty() {
            Some("Creator Mode needs an API key")
        } else if self.provider == Provider::Openai && self.base_url.trim().is_empty() {
            Some("Creator Mode needs the address of the OpenAI-compatible API")
        } else if self.model().is_empty() {
            Some("Creator Mode needs a model")
        } else {
            None
        }
    }

    /// What the settings window shows: never the key, only whether there is one.
    pub fn to_json(&self) -> String {
        serde_json::json!({
            "provider": self.provider.name(),
            "model": self.model.trim(),
            "default_model": if self.provider == Provider::Anthropic { ANTHROPIC_MODEL } else { "" },
            "base_url": self.base_url.trim(),
            "has_key": !self.api_key.trim().is_empty(),
            "ready": self.missing().is_none(),
        })
        .to_string()
    }
}

/// What the model answers.
#[derive(Debug, Deserialize)]
pub struct Draft {
    pub id: String,
    pub files: Vec<DraftFile>,
}

#[derive(Debug, Deserialize)]
pub struct DraftFile {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub executable: bool,
}

/// The answer's shape, for structured output.
fn draft_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "The plugin's id, as in its plugin.toml"},
            "files": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                        "executable": {"type": "boolean"}
                    },
                    "required": ["path", "content", "executable"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["id", "files"],
        "additionalProperties": false
    })
}

/// The instructions the model gets, with the whole contract.
pub fn system_prompt() -> String {
    format!(
        "You write plugins for Nokta, a notch (a dynamic island) for the Linux, \
macOS and Windows desktop. A user describes the plugin they want in one \
sentence; you write all of its files. The plugin contract follows.

<contract>
{CONTRACT}
</contract>

How to write it:
- Answer with one JSON object, nothing else: {{\"id\": ..., \"files\": \
[{{\"path\": ..., \"content\": ..., \"executable\": ...}}]}}. Paths are plain \
relative names such as plugin.toml or card.sh; no folders unless needed, no \
hidden files.
- plugin.toml has api = 1, an id of a-z, 0-9 and - that names what it does, \
a short name, a description of what it shows and what it reaches over the \
network, version = \"0.1.0\" and author = \"Creator Mode\".
- For Linux and macOS write a POSIX sh script run as [\"./name.sh\"], marked \
executable, using only what a desktop has: sh, curl, date, sed, awk, grep. \
Use python3 only when sh cannot do it well. For Windows write a PowerShell \
script with the windows command from the contract, when the plugin can work \
there.
- Print valid JSON in every case, also when a command fails or the network \
is down: then say so in the card. Escape text you put in JSON.
- Make anything the user may want to change an option: addresses, names, \
limits, how often. Pick an every that fits what it shows.
- Reach only what the request needs. Never ask for or store passwords or \
keys in files; take them as options. Write only in NOKTA_PLUGIN_DATA.
- Keep it small and readable: the user reads it before turning it on.
- If the request cannot be a Nokta plugin, still write the closest plugin \
that can be, and say what it does in its description."
    )
}

/// The request as the model reads it.
fn user_message(request: &str) -> String {
    format!(
        "<request>\n{}\n</request>\nWrite this plugin.",
        request.trim()
    )
}

#[derive(Clone, Debug)]
pub struct Creator {
    pub settings_file: PathBuf,
    /// Where a plugin is written before it is installed.
    pub staging: PathBuf,
    http: reqwest::Client,
}

impl Creator {
    pub fn new(settings_file: PathBuf, staging: PathBuf, user_agent: &str) -> Creator {
        Creator {
            settings_file,
            staging,
            http: http::client(|b| b.user_agent(user_agent).timeout(TIMEOUT)),
        }
    }

    pub fn settings(&self) -> Settings {
        Settings::load(&self.settings_file)
    }

    /// Sets the service. An empty key keeps the one saved.
    pub fn configure(
        &self,
        provider: &str,
        model: &str,
        base_url: &str,
        api_key: &str,
    ) -> Result<(), String> {
        let base_url = base_url.trim();
        if !base_url.is_empty()
            && !base_url.starts_with("https://")
            && !base_url.starts_with("http://")
        {
            return Err("the address is an http(s) address".into());
        }
        let old = self.settings();
        let settings = Settings {
            provider: Provider::parse(provider.trim())?,
            model: model.trim().to_owned(),
            base_url: base_url.to_owned(),
            api_key: match api_key.trim() {
                "" => old.api_key,
                key => key.to_owned(),
            },
        };
        settings.save(&self.settings_file)
    }

    /// Asks the model for the plugin `request` describes and installs it,
    /// off. `taken` are the ids of the plugins the user has; a new plugin
    /// never takes one. Answers its id.
    pub async fn create(
        &self,
        commands: &mpsc::Sender<Command>,
        taken: &[String],
        request: &str,
    ) -> Result<String, String> {
        let request = request.trim();
        if request.is_empty() {
            return Err("describe the plugin first".into());
        }
        if request.chars().count() > MAX_REQUEST {
            return Err(format!("describe it in at most {MAX_REQUEST} characters"));
        }
        let settings = self.settings();
        if let Some(missing) = settings.missing() {
            return Err(missing.into());
        }
        let answer = match settings.provider {
            Provider::Anthropic => self.ask_anthropic(&settings, request).await?,
            Provider::Openai => self.ask_openai(&settings, request).await?,
        };
        let draft: Draft = serde_json::from_str(strip_fence(&answer))
            .map_err(|err| format!("the model's answer was not a plugin: {err}"))?;
        let dir = self.staging.join("creator");
        let result = async {
            let id = write_draft(&draft, taken, &dir)?;
            let path = dir.clone();
            let installed =
                service::ask(commands, |reply| Command::Install { path, reply }).await?;
            debug_assert_eq!(installed, id);
            Ok(installed)
        }
        .await;
        let _ = tokio::fs::remove_dir_all(&dir).await;
        result
    }

    async fn ask_anthropic(&self, settings: &Settings, request: &str) -> Result<String, String> {
        let model = settings.model();
        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": MAX_TOKENS,
            "system": system_prompt(),
            "messages": [{"role": "user", "content": user_message(request)}],
            "output_config": {
                "effort": "medium",
                "format": {"type": "json_schema", "schema": draft_schema()}
            }
        });
        // Fallbacks are Anthropic's own; a proxy at another address may not
        // know them.
        let fallback = settings.base_url() == ANTHROPIC_URL && FALLBACK_MODELS.contains(&model);
        if fallback {
            body["fallbacks"] = "default".into();
        }
        let url = format!("{}/v1/messages", settings.base_url());
        let reply = self
            .post(&url, &body, |req| {
                let req = req
                    .header("x-api-key", settings.api_key.trim())
                    .header("anthropic-version", ANTHROPIC_VERSION);
                if fallback {
                    req.header("anthropic-beta", FALLBACK_BETA)
                } else {
                    req
                }
            })
            .await?;
        anthropic_text(&reply)
    }

    async fn ask_openai(&self, settings: &Settings, request: &str) -> Result<String, String> {
        let body = serde_json::json!({
            "model": settings.model(),
            "messages": [
                {"role": "system", "content": system_prompt()},
                {"role": "user", "content": user_message(request)}
            ],
            "response_format": {"type": "json_object"}
        });
        let url = format!("{}/chat/completions", settings.base_url());
        let reply = self
            .post(&url, &body, |req| req.bearer_auth(settings.api_key.trim()))
            .await?;
        openai_text(&reply)
    }

    /// One POST, tried a second time when the service is busy.
    async fn post(
        &self,
        url: &str,
        body: &serde_json::Value,
        auth: impl Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
    ) -> Result<serde_json::Value, String> {
        let mut tries = 0;
        loop {
            tries += 1;
            let resp = auth(self.http.post(url).json(body))
                .send()
                .await
                .map_err(|err| format!("cannot reach the AI service: {}", without_url(&err)))?;
            let status = resp.status();
            let wait = retry_after(resp.headers());
            let text = resp
                .text()
                .await
                .map_err(|err| format!("cannot reach the AI service: {}", without_url(&err)))?;
            if status.is_success() {
                return serde_json::from_str(&text)
                    .map_err(|err| format!("the AI service answered something else: {err}"));
            }
            let busy = status.as_u16() == 429 || status.as_u16() == 529 || status.is_server_error();
            if busy && tries < 2 {
                tokio::time::sleep(wait).await;
                continue;
            }
            return Err(status_error(status.as_u16(), &text));
        }
    }
}

/// How long the service asked to wait, up to 10 s; 2 s when it did not say.
fn retry_after(headers: &reqwest::header::HeaderMap) -> Duration {
    headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map_or(Duration::from_secs(2), |s| Duration::from_secs(s.min(10)))
}

/// A reqwest error names the URL; the address is the user's, but say less.
fn without_url(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "it took too long".into()
    } else if err.is_connect() {
        "no connection".into()
    } else {
        err.to_string()
    }
}

/// An error answer, in words; its own message when it has one.
pub fn status_error(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .and_then(|m| m.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_default();
    let what = match status {
        401 | 403 => "the AI service did not accept the API key".to_owned(),
        404 => "the AI service does not know this model or address".to_owned(),
        429 => "the AI service is busy, or the key has no credit left".to_owned(),
        500..=599 => "the AI service is busy; try again in a minute".to_owned(),
        _ => format!("the AI service answered {status}"),
    };
    let message: String = message.chars().take(200).collect();
    if message.is_empty() {
        what
    } else {
        format!("{what}: {message}")
    }
}

/// The text of a Messages API answer, or why there is none.
pub fn anthropic_text(reply: &serde_json::Value) -> Result<String, String> {
    match reply["stop_reason"].as_str() {
        Some("refusal") => return Err("the model declined to write this plugin".into()),
        Some("max_tokens") => {
            return Err("the plugin came out too long; describe a smaller one".into())
        }
        _ => {}
    }
    let text: String = reply["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    if text.trim().is_empty() {
        return Err("the model answered nothing".into());
    }
    Ok(text)
}

/// The text of a chat completion, or why there is none.
pub fn openai_text(reply: &serde_json::Value) -> Result<String, String> {
    let choice = &reply["choices"][0];
    match choice["finish_reason"].as_str() {
        Some("length") => return Err("the plugin came out too long; describe a smaller one".into()),
        Some("content_filter") => return Err("the model declined to write this plugin".into()),
        _ => {}
    }
    match choice["message"]["content"].as_str() {
        Some(text) if !text.trim().is_empty() => Ok(text.to_owned()),
        _ => Err("the model answered nothing".into()),
    }
}

/// A model asked for JSON may still wrap it in a Markdown fence.
fn strip_fence(text: &str) -> &str {
    let text = text.trim();
    let Some(rest) = text.strip_prefix("```") else {
        return text;
    };
    let rest = rest.split_once('\n').map_or("", |(_, body)| body);
    rest.trim_end().strip_suffix("```").unwrap_or(rest).trim()
}

/// Checks the draft and writes it into `dir`, emptied first, with an id no
/// plugin in `taken` has. Answers that id.
pub fn write_draft(draft: &Draft, taken: &[String], dir: &Path) -> Result<String, String> {
    if draft.files.is_empty() || draft.files.len() > MAX_FILES {
        return Err(format!(
            "the model wrote {} files; a plugin here has 1 to {MAX_FILES}",
            draft.files.len()
        ));
    }
    let mut paths = BTreeSet::new();
    for file in &draft.files {
        if !valid_path(&file.path) {
            return Err(format!("the model wrote a file at {:?}", file.path));
        }
        if !paths.insert(file.path.as_str()) {
            return Err(format!("the model wrote {} twice", file.path));
        }
        if file.content.len() > MAX_FILE_BYTES {
            return Err(format!("the model wrote too much in {}", file.path));
        }
    }
    let toml_file = draft
        .files
        .iter()
        .find(|f| f.path == manifest::FILE)
        .ok_or("the model wrote no plugin.toml")?;
    let mut doc: toml_edit::DocumentMut = toml_file
        .content
        .parse()
        .map_err(|err| format!("the model's plugin.toml is broken: {err}"))?;
    let wanted = doc
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or(&draft.id)
        .to_owned();
    let id = free_id(&wanted, taken);
    doc["id"] = toml_edit::value(id.as_str());

    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    for file in &draft.files {
        let target = dir.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let content = if file.path == manifest::FILE {
            doc.to_string()
        } else {
            file.content.clone()
        };
        std::fs::write(&target, content)
            .map_err(|err| format!("cannot write {}: {err}", target.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = if file.executable { 0o755 } else { 0o644 };
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode))
                .map_err(|err| err.to_string())?;
        }
    }
    // The same checks as a plugin added from a folder.
    install::read_manifest(dir).map_err(|err| format!("the model's plugin.toml: {err}"))?;
    Ok(id)
}

/// `wanted` made a valid id, with -2, -3… when a plugin has it already.
pub fn free_id(wanted: &str, taken: &[String]) -> String {
    let mut base: String = wanted
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    base = base.trim_matches('-').to_owned();
    base.truncate(36);
    let base = base.trim_end_matches('-').to_owned();
    let base = if manifest::valid_id(&base) {
        base
    } else {
        "my-plugin".to_owned()
    };
    if !taken.contains(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|id| !taken.contains(id))
        .expect("an unused id exists")
}
