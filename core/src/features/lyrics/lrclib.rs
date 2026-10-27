//! Client for the LRCLIB lyrics API (<https://lrclib.net>).
//!
//! `lookup` cleans the track up into candidates (see `clean`), tries the
//! exact `/api/get` endpoint with the best one and falls back to
//! `/api/search` for each candidate when the track is unknown, `get` is
//! overloaded or the length is outside what `get` accepts. A search result
//! counts only if its title and artist match the candidate and its duration
//! is within [`DURATION_TOLERANCE_S`] of the playing track.

use std::time::Duration;

use serde::Deserialize;

use super::clean::{self, normalized, Candidate};
use super::{lrc, Lookup};
use crate::shared::http;

/// Accepted difference between the player's track length and LRCLIB's.
pub const DURATION_TOLERANCE_S: f64 = 2.0;
/// `/api/get` rejects longer durations with 400; search still works for them.
const MAX_GET_DURATION_S: u64 = 3600;
const TIMEOUT: Duration = Duration::from_secs(10);

/// What to look up. `duration_s == 0` means the player did not report a length.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Query {
    pub artist: String,
    pub title: String,
    pub album: String,
    pub duration_s: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error("request to LRCLIB failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("LRCLIB answered with status {0}")]
    Status(reqwest::StatusCode),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(default)]
    track_name: String,
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

impl Record {
    /// Whether this is the candidate's song at the playing length
    /// (`duration_s == 0` when the player does not know it).
    fn matches(&self, candidate: &Candidate, duration_s: u64) -> bool {
        let artist = normalized(&candidate.artist);
        let theirs = normalized(&self.artist_name);
        normalized(&self.track_name) == normalized(&candidate.title)
            && (artist.is_empty()
                || (!theirs.is_empty() && (theirs.contains(&artist) || artist.contains(&theirs))))
            && (duration_s == 0
                || self
                    .duration
                    .is_some_and(|d| (d - duration_s as f64).abs() <= DURATION_TOLERANCE_S))
    }

    fn into_lookup(self) -> Lookup {
        if self.instrumental {
            return Lookup::Instrumental;
        }
        if let Some(synced) = self.synced_lyrics.filter(|s| !s.trim().is_empty()) {
            let lines = lrc::parse(&synced);
            return if lines.is_empty() {
                Lookup::Plain
            } else {
                Lookup::Synced(lines)
            };
        }
        if self.plain_lyrics.is_some_and(|p| !p.trim().is_empty()) {
            return Lookup::Plain;
        }
        Lookup::NotFound
    }
}

#[derive(Clone, Debug)]
pub struct Client {
    http: reqwest::Client,
    base_url: String,
}

impl Client {
    pub fn new(base_url: &str, user_agent: &str) -> Client {
        let http = http::client(|b| b.user_agent(user_agent).timeout(TIMEOUT));
        Client {
            http,
            base_url: base_url.trim_end_matches('/').to_owned(),
        }
    }

    pub async fn lookup(&self, q: &Query) -> Result<Lookup, FetchError> {
        let candidates = clean::candidates(&q.artist, &q.title);
        // `/api/get` answers 503 when it is busy asking upstream sources about a
        // track it does not have; search may still know it.
        let mut busy = None;
        if let Some(best) = candidates.first() {
            if (1..=MAX_GET_DURATION_S).contains(&q.duration_s) {
                let exact = Query {
                    artist: best.artist.clone(),
                    title: best.title.clone(),
                    ..q.clone()
                };
                match self.get(&exact).await {
                    Ok(Some(record)) => return Ok(record.into_lookup()),
                    Ok(None) => {}
                    Err(FetchError::Status(status)) if status.is_server_error() => {
                        busy = Some(FetchError::Status(status));
                    }
                    Err(err) => return Err(err),
                }
            }
        }
        for candidate in &candidates {
            let records = self.search(candidate).await?;
            if let Some(record) = records
                .into_iter()
                .find(|r| r.matches(candidate, q.duration_s))
            {
                return Ok(record.into_lookup());
            }
        }
        match busy {
            // Not "not found": that would be cached for a week.
            Some(err) => Err(err),
            None => Ok(Lookup::NotFound),
        }
    }

    async fn get(&self, q: &Query) -> Result<Option<Record>, FetchError> {
        let duration = q.duration_s.to_string();
        let resp = self
            .http
            .get(format!("{}/api/get", self.base_url))
            .query(&[
                ("artist_name", q.artist.as_str()),
                ("track_name", q.title.as_str()),
                ("album_name", q.album.as_str()),
                ("duration", duration.as_str()),
            ])
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(checked(resp)?.json().await?))
    }

    async fn search(&self, c: &Candidate) -> Result<Vec<Record>, FetchError> {
        let resp = self
            .http
            .get(format!("{}/api/search", self.base_url))
            .query(&[
                ("track_name", c.title.as_str()),
                ("artist_name", c.artist.as_str()),
            ])
            .send()
            .await?;
        Ok(checked(resp)?.json().await?)
    }
}

fn checked(resp: reqwest::Response) -> Result<reqwest::Response, FetchError> {
    let status = resp.status();
    if status.is_success() {
        Ok(resp)
    } else {
        Err(FetchError::Status(status))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::lyrics::{Line, Lookup};
    use serde_json::json;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const UA: &str = "Nokta/0.0.0 (https://github.com/MasRama/nokta)";

    fn query(duration_s: u64) -> Query {
        Query {
            artist: "Daft Punk".into(),
            title: "Get Lucky".into(),
            album: "Random Access Memories".into(),
            duration_s,
        }
    }

    fn record(
        duration: f64,
        synced: Option<&str>,
        plain: Option<&str>,
        instrumental: bool,
    ) -> serde_json::Value {
        json!({
            "id": 1, "trackName": "Get Lucky", "artistName": "Daft Punk",
            "albumName": "Random Access Memories", "duration": duration,
            "instrumental": instrumental, "plainLyrics": plain, "syncedLyrics": synced
        })
    }

    async fn client(server: &MockServer) -> Client {
        Client::new(&server.uri(), UA)
    }

    #[tokio::test]
    async fn get_hit_returns_synced() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .and(query_param("artist_name", "Daft Punk"))
            .and(query_param("track_name", "Get Lucky"))
            .and(query_param("album_name", "Random Access Memories"))
            .and(query_param("duration", "369"))
            .respond_with(ResponseTemplate::new(200).set_body_json(record(
                367.0,
                Some("[00:31.48] Like the legend of the phoenix"),
                Some("Like the legend of the phoenix"),
                false,
            )))
            .expect(1)
            .mount(&server)
            .await;
        let got = client(&server).await.lookup(&query(369)).await.unwrap();
        assert_eq!(
            got,
            Lookup::Synced(vec![Line {
                start_us: 31_480_000,
                text: "Like the legend of the phoenix".into()
            }])
        );
    }

    #[tokio::test]
    async fn instrumental_flag_wins() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(200).set_body_json(record(369.0, None, None, true)))
            .mount(&server)
            .await;
        assert_eq!(
            client(&server).await.lookup(&query(369)).await.unwrap(),
            Lookup::Instrumental
        );
    }

    #[tokio::test]
    async fn plain_only_is_plain() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(200).set_body_json(record(
                369.0,
                None,
                Some("words"),
                false,
            )))
            .mount(&server)
            .await;
        assert_eq!(
            client(&server).await.lookup(&query(369)).await.unwrap(),
            Lookup::Plain
        );
    }

    #[tokio::test]
    async fn get_404_falls_back_to_search_within_tolerance() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .and(query_param("track_name", "Get Lucky"))
            .and(query_param("artist_name", "Daft Punk"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                record(300.0, Some("[00:01.00]wrong"), None, false),
                record(367.0, Some("[00:02.00]right"), None, false),
            ])))
            .mount(&server)
            .await;
        let got = client(&server).await.lookup(&query(369)).await.unwrap();
        assert_eq!(
            got,
            Lookup::Synced(vec![Line {
                start_us: 2_000_000,
                text: "right".into()
            }])
        );
    }

    #[tokio::test]
    async fn search_outside_tolerance_is_not_found() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([record(
                300.0,
                Some("[00:01.00]x"),
                None,
                false
            )])))
            .mount(&server)
            .await;
        assert_eq!(
            client(&server).await.lookup(&query(369)).await.unwrap(),
            Lookup::NotFound
        );
    }

    #[tokio::test]
    async fn empty_search_is_not_found() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        assert_eq!(
            client(&server).await.lookup(&query(369)).await.unwrap(),
            Lookup::NotFound
        );
    }

    #[tokio::test]
    async fn over_an_hour_skips_get_and_searches() {
        let server = MockServer::start().await;
        // LRCLIB rejects get with duration above 3600 s: 400 ValidationError.
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(400))
            .expect(0)
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([record(
                8134.0,
                Some("[00:01.00]x"),
                None,
                false
            )])))
            .mount(&server)
            .await;
        let got = client(&server).await.lookup(&query(8134)).await.unwrap();
        assert_eq!(
            got,
            Lookup::Synced(vec![Line {
                start_us: 1_000_000,
                text: "x".into()
            }])
        );
    }

    #[tokio::test]
    async fn zero_duration_uses_search_without_filter() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([record(
                300.0,
                Some("[00:01.00]x"),
                None,
                false
            )])))
            .mount(&server)
            .await;
        let got = client(&server).await.lookup(&query(0)).await.unwrap();
        assert_eq!(
            got,
            Lookup::Synced(vec![Line {
                start_us: 1_000_000,
                text: "x".into()
            }])
        );
    }

    #[tokio::test]
    async fn server_error_is_fetch_error() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        assert!(client(&server).await.lookup(&query(369)).await.is_err());
    }

    #[tokio::test]
    async fn busy_get_falls_back_to_search() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([record(
                368.0,
                Some("[00:03.00]busy"),
                None,
                false
            )])))
            .mount(&server)
            .await;
        let got = client(&server).await.lookup(&query(369)).await.unwrap();
        assert_eq!(
            got,
            Lookup::Synced(vec![Line {
                start_us: 3_000_000,
                text: "busy".into()
            }])
        );
    }

    #[tokio::test]
    async fn busy_get_with_empty_search_is_an_error_not_not_found() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        assert!(client(&server).await.lookup(&query(369)).await.is_err());
    }

    #[tokio::test]
    async fn sends_user_agent() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .and(header("user-agent", UA))
            .respond_with(ResponseTemplate::new(200).set_body_json(record(369.0, None, None, true)))
            .expect(1)
            .mount(&server)
            .await;
        client(&server).await.lookup(&query(369)).await.unwrap();
    }

    #[tokio::test]
    async fn a_youtube_video_title_is_found_by_its_song() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .and(query_param("track_name", "Hati-Hati di Jalan"))
            .and(query_param("artist_name", "TULUS"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "trackName": "Hati\u{2010}Hati di Jalan", "artistName": "Tulus",
                "duration": 262.0, "instrumental": false,
                "syncedLyrics": "[00:12.00]Perjalanan membawamu"
            }])))
            .expect(1)
            .mount(&server)
            .await;
        let q = Query {
            artist: "TULUS Official".into(),
            title: "TULUS - Hati-Hati di Jalan (Official Music Video)".into(),
            album: String::new(),
            duration_s: 263,
        };
        assert_eq!(
            client(&server).await.lookup(&q).await.unwrap(),
            Lookup::Synced(vec![Line {
                start_us: 12_000_000,
                text: "Perjalanan membawamu".into()
            }])
        );
    }

    #[tokio::test]
    async fn a_search_result_for_another_song_is_not_taken() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"trackName": "Get Lucky Tonight", "artistName": "Daft Punk",
                 "duration": 369.0, "syncedLyrics": "[00:01.00]other"},
                {"trackName": "Get Lucky", "artistName": "Someone Else",
                 "duration": 369.0, "syncedLyrics": "[00:01.00]cover"},
            ])))
            .mount(&server)
            .await;
        assert_eq!(
            client(&server).await.lookup(&query(369)).await.unwrap(),
            Lookup::NotFound
        );
    }

    #[tokio::test]
    async fn the_next_candidate_is_searched_when_the_first_has_nothing() {
        let server = MockServer::start().await;
        Mock::given(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .and(query_param("artist_name", "Juicy Luicy"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        Mock::given(path("/api/search"))
            .and(query_param("artist_name", "Lagu Hits"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "trackName": "Juicy Luicy - Lantas", "artistName": "Lagu Hits",
                "duration": 0.0, "syncedLyrics": "[00:03.00]Lantas"
            }])))
            .mount(&server)
            .await;
        let q = Query {
            artist: "Lagu Hits".into(),
            title: "Juicy Luicy - Lantas (Lirik)".into(),
            album: String::new(),
            duration_s: 0,
        };
        assert!(matches!(
            client(&server).await.lookup(&q).await.unwrap(),
            Lookup::Synced(_)
        ));
    }
}
