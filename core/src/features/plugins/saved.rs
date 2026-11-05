//! `plugins.toml`, next to config.toml: which plugins are on and the
//! options the user set, one table per plugin.
//!
//! ```toml
//! [hello]
//! enabled = true
//! [hello.options]
//! name = "Ren"
//! ```

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::manifest::{Manifest, OptionValue};
use crate::shared::fs::write_atomically;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SavedPlugin {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, OptionValue>,
}

pub type Saved = BTreeMap<String, SavedPlugin>;

/// Reads `text`; a broken file reads as nothing on, with the reason.
pub fn parse(text: &str) -> Result<Saved, String> {
    toml::from_str(text).map_err(|e| e.message().to_owned())
}

pub fn to_text(saved: &Saved) -> String {
    let mut text = String::from(
        "# Nokta's plugins: which are on and their options. The settings window\n\
         # writes this file; you may edit it too.\n",
    );
    text.push_str(&toml::to_string(saved).expect("plugin settings always serialize"));
    text
}

/// Reads the file; missing or broken means nothing on.
pub async fn load(path: &Path) -> Saved {
    match tokio::fs::read_to_string(path).await {
        Ok(text) => parse(&text).unwrap_or_else(|err| {
            tracing::warn!("{} is broken, so no plugin runs: {err}", path.display());
            Saved::new()
        }),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Saved::new(),
        Err(err) => {
            tracing::warn!("cannot read {}: {err}", path.display());
            Saved::new()
        }
    }
}

pub async fn save(path: &Path, saved: &Saved) {
    if let Err(err) = write_atomically(path, to_text(saved)).await {
        tracing::warn!("cannot write {}: {err}", path.display());
    }
}

/// Each option's value for the plugin: the saved one when it still fits,
/// else the default.
pub fn values(manifest: &Manifest, saved: Option<&SavedPlugin>) -> Vec<(String, OptionValue)> {
    manifest
        .options
        .iter()
        .map(|spec| {
            let value = saved
                .and_then(|s| s.options.get(&spec.key))
                .and_then(|v| spec.accept(v))
                .unwrap_or_else(|| spec.default.clone());
            (spec.key.clone(), value)
        })
        .collect()
}
