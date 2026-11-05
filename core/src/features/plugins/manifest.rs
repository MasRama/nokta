//! A plugin's `plugin.toml`, read and checked. Pure: no file access.

use serde::{Deserialize, Serialize};

use crate::shared::paths::System;

/// The plugin API this Nokta speaks.
pub const API: u32 = 1;
/// The file in each plugin's folder.
pub const FILE: &str = "plugin.toml";

const MAX_OPTIONS: usize = 12;
const DEFAULT_EVERY_S: u32 = 300;
const DEFAULT_TIMEOUT_S: u32 = 20;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub homepage: String,
    /// An icon name, one of Nokta's or the system's; empty for the plugin icon.
    pub icon: String,
    pub run: Run,
    pub options: Vec<OptionSpec>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Run {
    /// The program and its arguments on Linux and macOS; a relative program
    /// (`./hello.sh`) is found in the plugin's folder.
    pub command: Vec<String>,
    /// The same on Windows.
    pub windows: Vec<String>,
    /// Seconds between runs; 0 keeps one process running that prints a line per change.
    pub every: u32,
    /// Seconds a run may take.
    pub timeout: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct OptionSpec {
    pub key: String,
    pub title: String,
    pub subtitle: String,
    #[serde(flatten)]
    pub kind: OptionKind,
    pub default: OptionValue,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum OptionKind {
    Text,
    Bool,
    Int { min: i64, max: i64 },
    Choice { choices: Vec<String> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OptionValue {
    Bool(bool),
    Int(i64),
    Text(String),
}

impl OptionValue {
    /// As the plugin reads it from its environment.
    pub fn as_env(&self) -> String {
        match self {
            OptionValue::Bool(b) => b.to_string(),
            OptionValue::Int(n) => n.to_string(),
            OptionValue::Text(t) => t.clone(),
        }
    }
}

impl OptionSpec {
    /// `value` if it fits this option, else none.
    pub fn accept(&self, value: &OptionValue) -> Option<OptionValue> {
        match (&self.kind, value) {
            (OptionKind::Bool, OptionValue::Bool(_)) => Some(value.clone()),
            (OptionKind::Int { min, max }, OptionValue::Int(n)) if n >= min && n <= max => {
                Some(value.clone())
            }
            (OptionKind::Text, OptionValue::Text(t)) if t.chars().count() <= 500 => {
                Some(value.clone())
            }
            (OptionKind::Choice { choices }, OptionValue::Text(t)) if choices.contains(t) => {
                Some(value.clone())
            }
            _ => None,
        }
    }

    /// The value the settings window sends as text, read for this option.
    pub fn parse(&self, text: &str) -> Result<OptionValue, String> {
        let value = match self.kind {
            OptionKind::Bool => match text {
                "true" => OptionValue::Bool(true),
                "false" => OptionValue::Bool(false),
                _ => return Err(format!("{} is true or false", self.key)),
            },
            OptionKind::Int { .. } => match text.trim().parse() {
                Ok(n) => OptionValue::Int(n),
                Err(_) => return Err(format!("{} is a whole number", self.key)),
            },
            OptionKind::Text | OptionKind::Choice { .. } => OptionValue::Text(text.to_owned()),
        };
        self.accept(&value).ok_or_else(|| match &self.kind {
            OptionKind::Int { min, max } => format!("{} is from {min} to {max}", self.key),
            OptionKind::Choice { choices } => {
                format!("{} is one of {}", self.key, choices.join(", "))
            }
            _ => format!("{} is too long", self.key),
        })
    }
}

impl Manifest {
    /// The program and arguments to run on `system`; none when the plugin
    /// does not run there.
    pub fn argv(&self, system: System) -> Option<&[String]> {
        let argv = match system {
            System::Windows => &self.run.windows,
            System::Linux | System::MacOs => &self.run.command,
        };
        (!argv.is_empty()).then_some(argv.as_slice())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawManifest {
    api: Option<u32>,
    id: Option<String>,
    name: Option<String>,
    #[serde(default)]
    description: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    homepage: String,
    #[serde(default)]
    icon: String,
    run: Option<RawRun>,
    #[serde(default)]
    options: Vec<RawOption>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRun {
    #[serde(default)]
    command: Vec<String>,
    #[serde(default)]
    windows: Vec<String>,
    every: Option<u32>,
    timeout: Option<u32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOption {
    key: String,
    title: String,
    #[serde(default)]
    subtitle: String,
    #[serde(rename = "type")]
    kind: String,
    default: Option<OptionValue>,
    min: Option<i64>,
    max: Option<i64>,
    #[serde(default)]
    choices: Vec<String>,
}

/// An id: lowercase letters, digits and dashes, 2 to 40, starting with a letter or digit.
pub fn valid_id(id: &str) -> bool {
    (2..=40).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !id.starts_with('-')
}

/// An icon name as GNOME and Nokta name them.
pub fn valid_icon(icon: &str) -> bool {
    icon.len() <= 64
        && icon
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
}

fn valid_key(key: &str) -> bool {
    (1..=32).contains(&key.len())
        && key.as_bytes()[0].is_ascii_lowercase()
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn limit(field: &str, value: String, max: usize) -> Result<String, String> {
    if value.chars().count() > max {
        return Err(format!("{field} is longer than {max} characters"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{field} has control characters"));
    }
    Ok(value)
}

/// Reads `text`, the contents of a `plugin.toml`.
pub fn parse(text: &str) -> Result<Manifest, String> {
    let raw: RawManifest = toml::from_str(text).map_err(|e| e.message().to_owned())?;
    match raw.api {
        None => return Err(format!("api = {API} is missing")),
        Some(api) if api > API => return Err(format!("needs a newer Nokta (plugin API {api})")),
        Some(api) if api < 1 => return Err("api is 1 or more".into()),
        Some(_) => {}
    }
    let id = raw.id.ok_or("id is missing")?;
    if !valid_id(&id) {
        return Err("id is 2 to 40 lowercase letters, digits and dashes".into());
    }
    let name = limit("name", raw.name.ok_or("name is missing")?, 40)?;
    if name.trim().is_empty() {
        return Err("name is empty".into());
    }
    let homepage = raw.homepage;
    if !homepage.is_empty() && !homepage.starts_with("https://") && !homepage.starts_with("http://")
    {
        return Err("homepage is an http(s) address".into());
    }
    if !valid_icon(&raw.icon) {
        return Err("icon is an icon name like weather-clear-symbolic".into());
    }
    let run = raw.run.ok_or("[run] is missing")?;
    if run.command.is_empty() && run.windows.is_empty() {
        return Err("[run] needs command or windows".into());
    }
    if run
        .command
        .iter()
        .chain(&run.windows)
        .any(|a| a.contains('\0'))
    {
        return Err("[run] has a NUL character".into());
    }
    let every = run.every.unwrap_or(DEFAULT_EVERY_S);
    if every != 0 && !(5..=86_400).contains(&every) {
        return Err("every is 0 or from 5 to 86400 seconds".into());
    }
    let timeout = run.timeout.unwrap_or(DEFAULT_TIMEOUT_S);
    if !(1..=120).contains(&timeout) {
        return Err("timeout is from 1 to 120 seconds".into());
    }
    if raw.options.len() > MAX_OPTIONS {
        return Err(format!("at most {MAX_OPTIONS} options"));
    }
    let mut options: Vec<OptionSpec> = Vec::new();
    for option in raw.options {
        let spec = read_option(option)?;
        if options.iter().any(|o| o.key == spec.key) {
            return Err(format!("option {} is there twice", spec.key));
        }
        options.push(spec);
    }
    Ok(Manifest {
        id,
        name,
        description: limit("description", raw.description, 160)?,
        version: limit("version", raw.version, 20)?,
        author: limit("author", raw.author, 60)?,
        homepage,
        icon: raw.icon,
        run: Run {
            command: run.command,
            windows: run.windows,
            every,
            timeout,
        },
        options,
    })
}

fn read_option(raw: RawOption) -> Result<OptionSpec, String> {
    if !valid_key(&raw.key) {
        return Err(format!(
            "option key {:?} is lowercase letters, digits and _",
            raw.key
        ));
    }
    let key = raw.key;
    let kind = match raw.kind.as_str() {
        "text" => OptionKind::Text,
        "bool" => OptionKind::Bool,
        "int" => {
            let (min, max) = (raw.min.unwrap_or(0), raw.max.unwrap_or(i64::from(u32::MAX)));
            if min > max {
                return Err(format!("option {key}: min is above max"));
            }
            OptionKind::Int { min, max }
        }
        "choice" => {
            if raw.choices.is_empty() || raw.choices.len() > 20 {
                return Err(format!("option {key}: 1 to 20 choices"));
            }
            OptionKind::Choice {
                choices: raw.choices,
            }
        }
        other => {
            return Err(format!(
                "option {key}: type {other:?} is text, bool, int or choice"
            ))
        }
    };
    let fallback = match &kind {
        OptionKind::Text => OptionValue::Text(String::new()),
        OptionKind::Bool => OptionValue::Bool(false),
        OptionKind::Int { min, .. } => OptionValue::Int(*min),
        OptionKind::Choice { choices } => OptionValue::Text(choices[0].clone()),
    };
    let mut spec = OptionSpec {
        title: limit("option title", raw.title, 40)?,
        subtitle: limit("option subtitle", raw.subtitle, 120)?,
        key,
        kind,
        default: fallback,
    };
    if let Some(default) = raw.default {
        spec.default = spec
            .accept(&default)
            .ok_or_else(|| format!("option {}: its default does not fit its type", spec.key))?;
    }
    Ok(spec)
}
