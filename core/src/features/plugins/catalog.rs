//! The plugin catalog: the plugins of github.com/MasRama/nokta-plugins, as
//! its `catalog` branch publishes them: `index.json` lists each plugin with
//! every one of its files, their size and SHA-256, and the files sit under
//! `plugins/<id>/`. A plugin is downloaded into a folder of its own, each
//! file checked against the index before it is written, and then installed
//! like one from a folder: it starts off, and an update keeps its switch and
//! options.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;

use super::install::{self, MAX_BYTES, MAX_FILES};
use super::manifest;
use super::service::{self, Command};
use crate::shared::http;
use crate::shared::paths::System;

pub const DEFAULT_URL: &str = "https://raw.githubusercontent.com/MasRama/nokta-plugins/catalog";
/// The version of `index.json` this Nokta reads.
const INDEX_API: u32 = 1;
const TIMEOUT: Duration = Duration::from_secs(20);
/// `index.json` is read up to this size.
const MAX_INDEX_BYTES: u64 = 1024 * 1024;

/// One plugin of the catalog.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Listing {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub homepage: String,
    #[serde(default)]
    pub icon: String,
    /// It has a command for Linux and macOS…
    #[serde(default)]
    pub unix: bool,
    /// …and for Windows.
    #[serde(default)]
    pub windows: bool,
    pub files: Vec<FileEntry>,
}

/// One file of a plugin: where it goes in its folder, and what it must be.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub executable: bool,
}

impl Listing {
    pub fn runs_on(&self, system: System) -> bool {
        match system {
            System::Windows => self.windows,
            System::Linux | System::MacOs => self.unix,
        }
    }
}

#[derive(Deserialize)]
struct Index {
    api: u32,
    #[serde(default)]
    plugins: Vec<serde_json::Value>,
}

/// Reads `index.json`. A plugin that does not fit is left out, so one bad
/// entry never hides the others.
pub fn parse(text: &str) -> Result<Vec<Listing>, String> {
    let index: Index =
        serde_json::from_str(text).map_err(|err| format!("the catalog is broken: {err}"))?;
    if index.api != INDEX_API {
        return Err(format!(
            "the catalog is for another Nokta (index version {})",
            index.api
        ));
    }
    let mut seen = BTreeSet::new();
    let mut listings = Vec::new();
    for value in index.plugins {
        let listing = match serde_json::from_value::<Listing>(value) {
            Ok(listing) => listing,
            Err(err) => {
                tracing::info!("left out a catalog entry: {err}");
                continue;
            }
        };
        match check(&listing) {
            Ok(()) if seen.insert(listing.id.clone()) => listings.push(listing),
            Ok(()) => tracing::info!(plugin = %listing.id, "left out a second catalog entry"),
            Err(err) => tracing::info!(plugin = %listing.id, "left out of the catalog: {err}"),
        }
    }
    Ok(listings)
}

fn check(listing: &Listing) -> Result<(), String> {
    if !manifest::valid_id(&listing.id) {
        return Err("its id is not valid".into());
    }
    if listing.name.trim().is_empty() || listing.version.trim().is_empty() {
        return Err("it has no name or version".into());
    }
    if listing.files.is_empty() || listing.files.len() > MAX_FILES {
        return Err("it has no files, or too many".into());
    }
    let mut paths = BTreeSet::new();
    let mut total = 0u64;
    for file in &listing.files {
        if !valid_path(&file.path) {
            return Err(format!("{:?} is not a path a plugin may have", file.path));
        }
        if !paths.insert(file.path.as_str()) {
            return Err(format!("{} is listed twice", file.path));
        }
        if file.sha256.len() != 64 || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("{} has no SHA-256", file.path));
        }
        total = total.saturating_add(file.size);
    }
    if !paths.contains(manifest::FILE) {
        return Err(format!("it has no {}", manifest::FILE));
    }
    if total > MAX_BYTES {
        return Err("its files are too big".into());
    }
    Ok(())
}

/// A relative path of plain names: letters, digits, `.`, `_` and `-`, none
/// hidden and none `..`, so a file can only land inside its plugin's folder.
pub fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 200
        && path.split('/').count() <= 6
        && path.split('/').all(|name| {
            !name.is_empty()
                && !name.starts_with('.')
                && name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        })
}

/// The catalog as the settings window shows it: one JSON object per plugin,
/// without its files, and whether it runs on this system.
pub fn to_json(listings: &[Listing], system: System) -> String {
    let rows: Vec<serde_json::Value> = listings
        .iter()
        .map(|l| {
            serde_json::json!({
                "id": l.id,
                "name": l.name,
                "description": l.description,
                "version": l.version,
                "author": l.author,
                "homepage": l.homepage,
                "icon": l.icon,
                "runs_here": l.runs_on(system),
            })
        })
        .collect();
    serde_json::Value::Array(rows).to_string()
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

#[derive(Clone, Debug)]
pub struct Client {
    http: reqwest::Client,
    url: String,
}

impl Client {
    pub fn new(url: &str, user_agent: &str) -> Client {
        Client {
            http: http::client(|b| b.user_agent(user_agent).timeout(TIMEOUT)),
            url: url.trim_end_matches('/').to_owned(),
        }
    }

    /// The catalog's plugins.
    pub async fn listings(&self) -> Result<Vec<Listing>, String> {
        let body = self
            .get(&format!("{}/index.json", self.url), MAX_INDEX_BYTES)
            .await?;
        parse(&String::from_utf8_lossy(&body))
    }

    /// Downloads the plugin's files into `dir`, which is emptied first. Each
    /// file must have its listed size and SHA-256.
    pub async fn download(&self, listing: &Listing, dir: &Path) -> Result<(), String> {
        let _ = tokio::fs::remove_dir_all(dir).await;
        for file in &listing.files {
            let url = format!("{}/plugins/{}/{}", self.url, listing.id, file.path);
            let data = self.get(&url, file.size).await?;
            if data.len() as u64 != file.size || sha256_hex(&data) != file.sha256.to_lowercase() {
                return Err(format!(
                    "{} did not match the catalog, so it was not installed",
                    file.path
                ));
            }
            let target = dir.join(&file.path);
            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|err| err.to_string())?;
            }
            tokio::fs::write(&target, &data)
                .await
                .map_err(|err| format!("cannot write {}: {err}", target.display()))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = if file.executable { 0o755 } else { 0o644 };
                tokio::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode))
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }
        Ok(())
    }

    /// One GET, read up to `limit` bytes; more fails it.
    async fn get(&self, url: &str, limit: u64) -> Result<Vec<u8>, String> {
        let unreachable = |err: reqwest::Error| format!("cannot reach the plugin catalog: {err}");
        let mut resp = self.http.get(url).send().await.map_err(unreachable)?;
        if !resp.status().is_success() {
            return Err(format!("the plugin catalog answered {}", resp.status()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(unreachable)? {
            body.extend_from_slice(&chunk);
            if body.len() as u64 > limit {
                return Err("the plugin catalog sent more than it listed".into());
            }
        }
        Ok(body)
    }
}

/// The catalog, and where its plugins are downloaded before they are installed.
#[derive(Clone, Debug)]
pub struct Source {
    pub client: Client,
    pub staging: PathBuf,
}

impl Source {
    /// The catalog as JSON for the settings window.
    pub async fn browse(&self) -> Result<String, String> {
        Ok(to_json(&self.client.listings().await?, System::current()))
    }

    /// Installs the catalog's plugin `id`, or updates it.
    pub async fn install(
        &self,
        commands: &mpsc::Sender<Command>,
        id: &str,
    ) -> Result<String, String> {
        install_from(&self.client, commands, &self.staging, id).await
    }
}

/// Downloads the catalog's plugin `id` into `staging/<id>`, checks its
/// `plugin.toml` names it, and hands the folder to the plugins service.
/// Answers its id.
pub async fn install_from(
    client: &Client,
    commands: &mpsc::Sender<Command>,
    staging: &Path,
    id: &str,
) -> Result<String, String> {
    let listings = client.listings().await?;
    let listing = listings
        .iter()
        .find(|l| l.id == id)
        .ok_or_else(|| format!("the catalog has no plugin {id}"))?;
    let dir = staging.join(id);
    let result = async {
        client.download(listing, &dir).await?;
        let manifest = install::read_manifest(&dir)?;
        if manifest.id != listing.id {
            return Err(format!("its plugin.toml names {}, not {id}", manifest.id));
        }
        let path = dir.clone();
        service::ask(commands, |reply| Command::Install { path, reply }).await
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&dir).await;
    result
}
