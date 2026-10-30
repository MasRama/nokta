//! Client for GitHub's releases API: Nokta's latest release and its files.

use std::time::Duration;

use serde::Deserialize;

use crate::shared::http;

pub const DEFAULT_API_URL: &str = "https://api.github.com";
const REPO: &str = "MasRama/nokta";
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error("request to GitHub failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("GitHub answered with status {0}")]
    Status(reqwest::StatusCode),
}

/// The newest release; GitHub leaves out drafts and pre-releases.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Release {
    #[serde(rename = "tag_name")]
    pub tag: String,
    /// The release's web page.
    #[serde(rename = "html_url")]
    pub url: String,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Asset {
    pub name: String,
    #[serde(rename = "browser_download_url")]
    pub url: String,
}

impl Release {
    pub fn asset(&self, name: &str) -> Option<&Asset> {
        self.assets.iter().find(|a| a.name == name)
    }
}

#[derive(Clone, Debug)]
pub struct Client {
    http: reqwest::Client,
    api_url: String,
}

impl Client {
    pub fn new(api_url: &str, user_agent: &str) -> Client {
        Client {
            http: http::client(|b| b.user_agent(user_agent).timeout(TIMEOUT)),
            api_url: api_url.trim_end_matches('/').to_owned(),
        }
    }

    /// One request to `/repos/MasRama/nokta/releases/latest`.
    pub async fn latest(&self) -> Result<Release, FetchError> {
        let resp = self
            .http
            .get(format!("{}/repos/{REPO}/releases/latest", self.api_url))
            .header("Accept", "application/vnd.github+json")
            .send()
            .await?;
        Ok(checked(resp)?.json().await?)
    }
}

pub fn checked(resp: reqwest::Response) -> Result<reqwest::Response, FetchError> {
    let status = resp.status();
    if status.is_success() {
        Ok(resp)
    } else {
        Err(FetchError::Status(status))
    }
}
