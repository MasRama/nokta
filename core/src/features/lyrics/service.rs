//! Keeps `LyricsState` in step with the active track: the user's own `.lrc`
//! file first, then the cache, then LRCLIB, and never publishes a result for
//! a track that is no longer playing. The lines go out shifted by the
//! user's offset for the track, kept in `lyrics-offsets.toml`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::future::BoxFuture;
use tokio::sync::{mpsc, oneshot, watch};

use super::cache::Cache;
use super::key::TrackKey;
use super::local;
use super::lrclib::{Client, FetchError, Query};
use super::offsets::{self, Offsets};
use super::{Lookup, LyricsState, Status};
use crate::features::media::MediaState;
use crate::shared::fs::write_atomically;

/// Where lyrics come from. Implemented by the LRCLIB client; tests inject fakes.
pub trait LyricsSource: Send + Sync {
    fn lookup<'a>(&'a self, q: &'a Query) -> BoxFuture<'a, Result<Lookup, FetchError>>;
}

impl LyricsSource for Client {
    fn lookup<'a>(&'a self, q: &'a Query) -> BoxFuture<'a, Result<Lookup, FetchError>> {
        Box::pin(Client::lookup(self, q))
    }
}

/// `SetOffset` with no track, or with lyrics off: there is nothing to keep it for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NoTrack;

#[derive(Debug)]
pub enum Command {
    /// Sets the current track's offset; answers with the clamped value once
    /// it is published.
    SetOffset(i64, oneshot::Sender<Result<i64, NoTrack>>),
}

/// The service's commands and its published state.
pub struct Handle {
    pub state: watch::Receiver<LyricsState>,
    pub commands: mpsc::Sender<Command>,
}

pub fn spawn(
    media: watch::Receiver<MediaState>,
    enabled: watch::Receiver<bool>,
    cache: Cache,
    source: Arc<dyn LyricsSource>,
    local_dir: PathBuf,
    offsets_file: PathBuf,
) -> Handle {
    let (tx, state) = watch::channel(LyricsState::default());
    let (commands, commands_rx) = mpsc::channel(8);
    let files = Files {
        cache: Arc::new(cache),
        local_dir,
        offsets_file,
    };
    tokio::spawn(run(media, enabled, commands_rx, files, source, tx));
    Handle { state, commands }
}

struct Files {
    cache: Arc<Cache>,
    local_dir: PathBuf,
    offsets_file: PathBuf,
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

/// The current track: what was found for it, unshifted, and its offset.
struct Current {
    key: TrackKey,
    found: LyricsState,
    offset_ms: i64,
}

async fn run(
    mut media: watch::Receiver<MediaState>,
    mut enabled: watch::Receiver<bool>,
    mut commands: mpsc::Receiver<Command>,
    files: Files,
    source: Arc<dyn LyricsSource>,
    tx: watch::Sender<LyricsState>,
) {
    let mut offsets = load_offsets(&files.offsets_file).await;
    let (done_tx, mut done_rx) = mpsc::unbounded_channel::<(TrackKey, LyricsState)>();
    let mut current: Option<Current> = None;
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
        if wanted.as_ref().map(|r| &r.key) != current.as_ref().map(|c| &c.key) {
            current = match wanted {
                Some(request) => Some(Current {
                    offset_ms: offsets.get(&request.key.offset_name()),
                    key: request.key.clone(),
                    found: start(request, &files, &source, &done_tx).await,
                }),
                None => None,
            };
            publish(&tx, current.as_ref());
        }
        tokio::select! {
            changed = media.changed() => if changed.is_err() { break },
            changed = enabled.changed() => if changed.is_err() { break },
            Some((key, state)) = done_rx.recv() => {
                if let Some(c) = current.as_mut().filter(|c| c.key == key) {
                    c.found = state;
                    publish(&tx, Some(c));
                }
            }
            Some(command) = commands.recv() => match command {
                Command::SetOffset(offset_ms, reply) => {
                    let Some(c) = current.as_mut() else {
                        let _ = reply.send(Err(NoTrack));
                        continue;
                    };
                    c.offset_ms = offsets.set(&c.key.offset_name(), offset_ms);
                    publish(&tx, Some(c));
                    let written = write_atomically(&files.offsets_file, offsets.to_toml()).await;
                    if let Err(err) = written {
                        tracing::warn!(%err, "cannot write {}", files.offsets_file.display());
                    }
                    let _ = reply.send(Ok(c.offset_ms));
                }
            },
        }
    }
}

/// The saved offsets; none when the file is missing or broken.
async fn load_offsets(file: &Path) -> Offsets {
    match tokio::fs::read_to_string(file).await {
        Ok(text) => Offsets::parse(&text).unwrap_or_else(|err| {
            tracing::warn!("ignoring {}: {err}", file.display());
            Offsets::default()
        }),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Offsets::default(),
        Err(err) => {
            tracing::warn!(%err, "cannot read {}", file.display());
            Offsets::default()
        }
    }
}

/// What is known about the track right away: the user's own lyrics, a
/// cached answer, or else loading while LRCLIB is asked.
async fn start(
    request: Request,
    files: &Files,
    source: &Arc<dyn LyricsSource>,
    done: &mpsc::UnboundedSender<(TrackKey, LyricsState)>,
) -> LyricsState {
    // The lyrics folder, a song's own folder and the cache can sit on a
    // slow disk or mount: read them off the async runtime.
    let (local_dir, cache) = (files.local_dir.clone(), files.cache.clone());
    let (key, query, url) = (
        request.key.clone(),
        request.query.clone(),
        request.url.clone(),
    );
    let known = tokio::task::spawn_blocking(move || {
        known(&local_dir, &cache, &key, &query, url.as_deref())
    })
    .await;
    if let Ok(Some(state)) = known {
        return state;
    }
    let (cache, source, done) = (files.cache.clone(), source.clone(), done.clone());
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
                    ..LyricsState::default()
                }
            }
        };
        let _ = done.send((key, state));
    });
    LyricsState {
        status: Status::Loading,
        ..LyricsState::default()
    }
}

/// The user's own lyrics for the track, else a cached answer; blocks on
/// the disk.
fn known(
    local_dir: &Path,
    cache: &Cache,
    key: &TrackKey,
    query: &Query,
    url: Option<&str>,
) -> Option<LyricsState> {
    if let Some(lines) = local::find(local_dir, url, &query.artist, &query.title) {
        return Some(LyricsState {
            status: Status::Synced,
            lines,
            offset_ms: 0,
        });
    }
    cache.get(key, now_unix()).map(LyricsState::from)
}

/// Publishes the current track's lyrics, shifted by its offset, or none.
fn publish(tx: &watch::Sender<LyricsState>, current: Option<&Current>) {
    let next = current.map_or_else(LyricsState::default, |c| LyricsState {
        status: c.found.status,
        lines: offsets::shift(&c.found.lines, c.offset_ms),
        offset_ms: c.offset_ms,
    });
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
        commands: mpsc::Sender<Command>,
        requests: Arc<Mutex<mpsc::UnboundedReceiver<(Query, Reply)>>>,
        cache: Cache,
        _dir: Arc<tempfile::TempDir>,
    }

    fn start(enabled: bool) -> Harness {
        start_in(Arc::new(tempfile::tempdir().unwrap()), enabled)
    }

    /// Starts the service on the files in `dir`, as after a restart.
    fn start_in(dir: Arc<tempfile::TempDir>, enabled: bool) -> Harness {
        let (media, media_rx) = watch::channel(MediaState::default());
        let (enabled_tx, enabled_rx) = watch::channel(enabled);
        let (req_tx, req_rx) = mpsc::unbounded_channel();
        let source = Arc::new(FakeSource { requests: req_tx });
        let Handle { state, commands } = spawn(
            media_rx,
            enabled_rx,
            Cache::new(dir.path().to_owned()),
            source,
            dir.path().join("lyrics"),
            offsets_file(&dir),
        );
        Harness {
            media,
            enabled: enabled_tx,
            lyrics: state,
            commands,
            requests: Arc::new(Mutex::new(req_rx)),
            cache: Cache::new(dir.path().to_owned()),
            _dir: dir,
        }
    }

    fn offsets_file(dir: &tempfile::TempDir) -> std::path::PathBuf {
        dir.path().join("lyrics-offsets.toml")
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
        async fn set_offset(&self, offset_ms: i64) -> Result<i64, NoTrack> {
            let (done, answer) = oneshot::channel();
            self.commands
                .send(Command::SetOffset(offset_ms, done))
                .await
                .unwrap();
            answer.await.unwrap()
        }

        fn saved(&self) -> String {
            std::fs::read_to_string(offsets_file(&self._dir)).unwrap_or_default()
        }

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

    fn starts(state: &LyricsState) -> Vec<i64> {
        state.lines.iter().map(|l| l.start_us).collect()
    }

    #[tokio::test]
    async fn an_offset_shifts_the_lines_and_stays_with_the_track() {
        let dir = Arc::new(tempfile::tempdir().unwrap());
        let mut h = start_in(dir.clone(), true);
        h.cache.put(&key("A"), &synced("a"), now_unix()).unwrap();
        h.cache.put(&key("B"), &synced("b"), now_unix()).unwrap();
        h.media.send_replace(playing("A"));
        h.wait("A", |s| s.status == Status::Synced).await;

        // The lines and the offset change together, in one state.
        assert_eq!(h.set_offset(500).await, Ok(500));
        let s = h.lyrics.borrow().clone();
        assert_eq!((s.offset_ms, starts(&s)), (500, vec![500_000]));
        assert!(
            h.saved()
                .contains(&format!("{} = 500", key("A").offset_name())),
            "{}",
            h.saved()
        );

        h.media.send_replace(playing("B"));
        let s = h
            .wait("B", |s| s.lines.first().is_some_and(|l| l.text == "b"))
            .await;
        assert_eq!((s.offset_ms, starts(&s)), (0, vec![1_000_000]));

        h.media.send_replace(playing("A"));
        let s = h
            .wait("A again", |s| {
                s.lines.first().is_some_and(|l| l.text == "a")
            })
            .await;
        assert_eq!((s.offset_ms, starts(&s)), (500, vec![500_000]));

        drop(h);
        let mut h = start_in(dir, true);
        h.media.send_replace(playing("A"));
        let s = h
            .wait("A after a restart", |s| s.status == Status::Synced)
            .await;
        assert_eq!((s.offset_ms, starts(&s)), (500, vec![500_000]));
    }

    #[tokio::test]
    async fn an_offset_set_while_loading_applies_to_the_lines_that_come() {
        let mut h = start(true);
        h.media.send_replace(playing("A"));
        h.wait("loading", |s| s.status == Status::Loading).await;
        let (_, reply) = h.next_request().await;
        assert_eq!(h.set_offset(-250).await, Ok(-250));
        assert_eq!(h.lyrics.borrow().offset_ms, -250);
        reply.send(Ok(synced("late"))).unwrap();
        let s = h.wait("fetched", |s| s.status == Status::Synced).await;
        assert_eq!((s.offset_ms, starts(&s)), (-250, vec![1_250_000]));
    }

    #[tokio::test]
    async fn an_offset_is_clamped_and_zero_forgets_it() {
        let mut h = start(true);
        h.cache.put(&key("A"), &synced("a"), now_unix()).unwrap();
        h.media.send_replace(playing("A"));
        h.wait("A", |s| s.status == Status::Synced).await;
        assert_eq!(h.set_offset(99_999).await, Ok(30_000));
        assert_eq!(starts(&h.lyrics.borrow()), [0], "not before the start");
        assert_eq!(h.set_offset(0).await, Ok(0));
        assert_eq!(starts(&h.lyrics.borrow()), [1_000_000]);
        assert!(
            !h.saved().contains(&key("A").offset_name()),
            "{}",
            h.saved()
        );
    }

    #[tokio::test]
    async fn without_a_track_there_is_no_offset_to_set() {
        let h = start(true);
        assert_eq!(h.set_offset(250).await, Err(NoTrack));
        assert_eq!(h.lyrics.borrow().offset_ms, 0);
        let h = start(false);
        h.media.send_replace(playing("A"));
        assert_eq!(h.set_offset(250).await, Err(NoTrack), "lyrics are off");
    }

    #[tokio::test]
    async fn a_broken_offsets_file_starts_empty_and_is_replaced() {
        let dir = Arc::new(tempfile::tempdir().unwrap());
        std::fs::write(offsets_file(&dir), "not toml").unwrap();
        let mut h = start_in(dir, true);
        h.cache.put(&key("A"), &synced("a"), now_unix()).unwrap();
        h.media.send_replace(playing("A"));
        let s = h.wait("A", |s| s.status == Status::Synced).await;
        assert_eq!(s.offset_ms, 0);
        assert_eq!(h.set_offset(750).await, Ok(750));
        assert!(Offsets::parse(&h.saved()).is_ok(), "{}", h.saved());
    }
}
