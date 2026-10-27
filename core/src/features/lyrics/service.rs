//! Keeps `LyricsState` in step with the active track: the user's own `.lrc`
//! file first, then the cache, then LRCLIB, and never publishes a result for
//! a track that is no longer playing.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::future::BoxFuture;
use tokio::sync::{mpsc, watch};

use super::cache::Cache;
use super::key::TrackKey;
use super::local;
use super::lrclib::{Client, FetchError, Query};
use super::{Lookup, LyricsState, Status};
use crate::features::media::MediaState;

/// Where lyrics come from. Implemented by the LRCLIB client; tests inject fakes.
pub trait LyricsSource: Send + Sync {
    fn lookup<'a>(&'a self, q: &'a Query) -> BoxFuture<'a, Result<Lookup, FetchError>>;
}

impl LyricsSource for Client {
    fn lookup<'a>(&'a self, q: &'a Query) -> BoxFuture<'a, Result<Lookup, FetchError>> {
        Box::pin(Client::lookup(self, q))
    }
}

pub fn spawn(
    media: watch::Receiver<MediaState>,
    enabled: watch::Receiver<bool>,
    cache: Cache,
    source: Arc<dyn LyricsSource>,
    local_dir: PathBuf,
) -> watch::Receiver<LyricsState> {
    let (tx, rx) = watch::channel(LyricsState::default());
    tokio::spawn(run(media, enabled, Arc::new(cache), source, local_dir, tx));
    rx
}

struct Request {
    key: TrackKey,
    query: Query,
    url: Option<String>,
}

fn request_for(media: &MediaState) -> Option<Request> {
    let track = &media.track;
    if !media.available || track.title.trim().is_empty() {
        return None;
    }
    let key = TrackKey::new(
        &track.artists.join(", "),
        &track.title,
        &track.album,
        track.length_us,
    );
    // LRCLIB records usually carry the main artist only.
    let query = Query {
        artist: track.artists.first().cloned().unwrap_or_default(),
        title: track.title.clone(),
        album: track.album.clone(),
        duration_s: u64::try_from((track.length_us + 500_000) / 1_000_000).unwrap_or(0),
    };
    Some(Request {
        key,
        query,
        url: track.url.clone(),
    })
}

async fn run(
    mut media: watch::Receiver<MediaState>,
    mut enabled: watch::Receiver<bool>,
    cache: Arc<Cache>,
    source: Arc<dyn LyricsSource>,
    local_dir: PathBuf,
    tx: watch::Sender<LyricsState>,
) {
    let (done_tx, mut done_rx) = mpsc::unbounded_channel::<(TrackKey, LyricsState)>();
    let mut current: Option<TrackKey> = None;
    loop {
        let wanted = {
            let is_enabled = *enabled.borrow_and_update();
            let media = media.borrow_and_update();
            if is_enabled {
                request_for(&media)
            } else {
                None
            }
        };
        if wanted.as_ref().map(|r| &r.key) != current.as_ref() {
            current = wanted.as_ref().map(|r| r.key.clone());
            match wanted {
                None => publish(&tx, LyricsState::default()),
                Some(request) => start(request, &local_dir, &cache, &source, &tx, &done_tx),
            }
        }
        tokio::select! {
            changed = media.changed() => if changed.is_err() { break },
            changed = enabled.changed() => if changed.is_err() { break },
            Some((key, state)) = done_rx.recv() => {
                if current.as_ref() == Some(&key) {
                    publish(&tx, state);
                }
            }
        }
    }
}

fn start(
    request: Request,
    local_dir: &Path,
    cache: &Arc<Cache>,
    source: &Arc<dyn LyricsSource>,
    tx: &watch::Sender<LyricsState>,
    done: &mpsc::UnboundedSender<(TrackKey, LyricsState)>,
) {
    let q = &request.query;
    if let Some(lines) = local::find(local_dir, request.url.as_deref(), &q.artist, &q.title) {
        publish(
            tx,
            LyricsState {
                status: Status::Synced,
                lines,
            },
        );
        return;
    }
    if let Some(hit) = cache.get(&request.key, now_unix()) {
        publish(tx, hit.into());
        return;
    }
    publish(
        tx,
        LyricsState {
            status: Status::Loading,
            lines: Vec::new(),
        },
    );
    let (cache, source, done) = (cache.clone(), source.clone(), done.clone());
    tokio::spawn(async move {
        let Request { key, query, .. } = request;
        let state = match source.lookup(&query).await {
            Ok(lookup) => {
                let (cache, key, to_store) = (cache.clone(), key.clone(), lookup.clone());
                let stored =
                    tokio::task::spawn_blocking(move || cache.put(&key, &to_store, now_unix()))
                        .await;
                if let Ok(Err(err)) = stored {
                    tracing::warn!(%err, "cannot write the lyrics cache");
                }
                LyricsState::from(lookup)
            }
            Err(err) => {
                tracing::info!(%err, title = %query.title, "lyrics lookup failed");
                LyricsState {
                    status: Status::Error,
                    lines: Vec::new(),
                }
            }
        };
        let _ = done.send((key, state));
    });
}

fn publish(tx: &watch::Sender<LyricsState>, next: LyricsState) {
    tx.send_if_modified(|current| {
        if *current == next {
            return false;
        }
        *current = next;
        true
    });
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use futures_util::future::BoxFuture;
    use tokio::sync::{mpsc, oneshot, watch, Mutex};

    use super::*;
    use crate::features::lyrics::cache::Cache;
    use crate::features::lyrics::key::TrackKey;
    use crate::features::lyrics::lrclib::{FetchError, Query};
    use crate::features::lyrics::{Line, Lookup, LyricsState, Status};
    use crate::features::media::{MediaState, Track};

    type Reply = oneshot::Sender<Result<Lookup, FetchError>>;

    /// A source whose answers the test hands out one by one.
    struct FakeSource {
        requests: mpsc::UnboundedSender<(Query, Reply)>,
    }

    impl LyricsSource for FakeSource {
        fn lookup<'a>(&'a self, q: &'a Query) -> BoxFuture<'a, Result<Lookup, FetchError>> {
            let (reply, answer) = oneshot::channel();
            self.requests.send((q.clone(), reply)).unwrap();
            Box::pin(async move { answer.await.unwrap() })
        }
    }

    struct Harness {
        media: watch::Sender<MediaState>,
        enabled: watch::Sender<bool>,
        lyrics: watch::Receiver<LyricsState>,
        requests: Arc<Mutex<mpsc::UnboundedReceiver<(Query, Reply)>>>,
        cache: Cache,
        _dir: tempfile::TempDir,
    }

    fn start(enabled: bool) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let (media, media_rx) = watch::channel(MediaState::default());
        let (enabled_tx, enabled_rx) = watch::channel(enabled);
        let (req_tx, req_rx) = mpsc::unbounded_channel();
        let source = Arc::new(FakeSource { requests: req_tx });
        let lyrics = spawn(
            media_rx,
            enabled_rx,
            Cache::new(dir.path().to_owned()),
            source,
            dir.path().join("lyrics"),
        );
        Harness {
            media,
            enabled: enabled_tx,
            lyrics,
            requests: Arc::new(Mutex::new(req_rx)),
            cache: Cache::new(dir.path().to_owned()),
            _dir: dir,
        }
    }

    fn playing(title: &str) -> MediaState {
        MediaState {
            available: true,
            track: Track {
                track_id: Some(format!("/t/{title}")),
                title: title.into(),
                artists: vec!["Artist".into(), "Guest".into()],
                album: "Album".into(),
                length_us: 200_000_000,
                ..Track::default()
            },
            ..MediaState::default()
        }
    }

    fn key(title: &str) -> TrackKey {
        TrackKey::new("Artist, Guest", title, "Album", 200_000_000)
    }

    fn synced(text: &str) -> Lookup {
        Lookup::Synced(vec![Line {
            start_us: 1_000_000,
            text: text.into(),
        }])
    }

    impl Harness {
        async fn next_request(&self) -> (Query, Reply) {
            let mut rx = self.requests.lock().await;
            tokio::time::timeout(Duration::from_secs(5), rx.recv())
                .await
                .expect("expected a lookup")
                .unwrap()
        }

        async fn no_request(&self) {
            let mut rx = self.requests.lock().await;
            let got = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await;
            assert!(
                got.is_err(),
                "unexpected lookup: {:?}",
                got.unwrap().map(|r| r.0)
            );
        }

        async fn wait(
            &mut self,
            what: &str,
            pred: impl FnMut(&LyricsState) -> bool,
        ) -> LyricsState {
            tokio::time::timeout(Duration::from_secs(5), self.lyrics.wait_for(pred))
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
                .unwrap()
                .clone()
        }
    }

    #[tokio::test]
    async fn a_local_lrc_file_wins_over_the_cache_and_the_network() {
        let mut h = start(true);
        h.cache
            .put(&key("A"), &synced("cached"), now_unix())
            .unwrap();
        let dir = h._dir.path().join("lyrics");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Artist - A.lrc"), "[00:03.00]mine\n").unwrap();
        h.media.send_replace(playing("A"));
        let s = h.wait("local lyrics", |s| s.status == Status::Synced).await;
        assert_eq!(s.lines[0].text, "mine");
        h.no_request().await;
    }

    #[tokio::test]
    async fn cache_hit_skips_network() {
        let mut h = start(true);
        h.cache
            .put(&key("A"), &synced("cached"), now_unix())
            .unwrap();
        h.media.send_replace(playing("A"));
        let s = h
            .wait("cached lyrics", |s| s.status == Status::Synced)
            .await;
        assert_eq!(s.lines[0].text, "cached");
        h.no_request().await;
    }

    #[tokio::test]
    async fn miss_fetches_caches_and_publishes() {
        let mut h = start(true);
        h.media.send_replace(playing("A"));
        h.wait("loading", |s| s.status == Status::Loading).await;
        let (q, reply) = h.next_request().await;
        assert_eq!(
            q,
            Query {
                artist: "Artist".into(),
                title: "A".into(),
                album: "Album".into(),
                duration_s: 200
            }
        );
        reply.send(Ok(synced("fetched"))).unwrap();
        let s = h
            .wait("fetched lyrics", |s| s.status == Status::Synced)
            .await;
        assert_eq!(s.lines[0].text, "fetched");
        assert_eq!(h.cache.get(&key("A"), now_unix()), Some(synced("fetched")));
    }

    #[tokio::test]
    async fn stale_lookup_is_discarded() {
        let mut h = start(true);
        h.media.send_replace(playing("A"));
        let (_, reply_a) = h.next_request().await;
        h.media.send_replace(playing("B"));
        let (q_b, reply_b) = h.next_request().await;
        assert_eq!(q_b.title, "B");
        reply_a.send(Ok(synced("from A"))).unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(h.lyrics.borrow().status, Status::Loading);
        reply_b.send(Ok(Lookup::Instrumental)).unwrap();
        h.wait("B's lyrics", |s| s.status == Status::Instrumental)
            .await;
    }

    #[tokio::test]
    async fn disabled_publishes_none_without_lookup() {
        let mut h = start(false);
        h.media.send_replace(playing("A"));
        h.no_request().await;
        assert_eq!(*h.lyrics.borrow(), LyricsState::default());

        h.enabled.send_replace(true);
        let (_, reply) = h.next_request().await;
        reply.send(Ok(Lookup::NotFound)).unwrap();
        h.wait("not found", |s| s.status == Status::NotFound).await;

        h.enabled.send_replace(false);
        h.wait("none again", |s| s.status == Status::None).await;
    }

    #[tokio::test]
    async fn no_track_is_none() {
        let mut h = start(true);
        h.cache
            .put(&key("A"), &synced("cached"), now_unix())
            .unwrap();
        h.media.send_replace(playing("A"));
        h.wait("cached", |s| s.status == Status::Synced).await;
        h.media.send_replace(MediaState::default());
        h.wait("none", |s| *s == LyricsState::default()).await;
    }

    #[tokio::test]
    async fn error_is_not_cached() {
        let mut h = start(true);
        h.media.send_replace(playing("A"));
        let (_, reply) = h.next_request().await;
        reply
            .send(Err(FetchError::Status(reqwest::StatusCode::BAD_GATEWAY)))
            .unwrap();
        h.wait("error", |s| s.status == Status::Error).await;
        assert_eq!(h.cache.get(&key("A"), now_unix()), None);
    }

    #[tokio::test]
    async fn same_track_metadata_refresh_does_not_refetch() {
        let mut h = start(true);
        h.media.send_replace(playing("A"));
        let (_, reply) = h.next_request().await;
        reply.send(Ok(synced("x"))).unwrap();
        h.wait("lyrics", |s| s.status == Status::Synced).await;

        let mut refreshed = playing("A");
        refreshed.position_us = 50_000_000;
        refreshed.track.art_url = Some("file:///cover.png".into());
        h.media.send_replace(refreshed);
        h.no_request().await;
        assert_eq!(h.lyrics.borrow().status, Status::Synced);
    }
}
