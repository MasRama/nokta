//! Keeps `LyricsState` in step with the active track: the lyrics the user
//! picked for it, else the user's own `.lrc` file, then the cache, then
//! LRCLIB, and never publishes a result for a track that is no longer
//! playing. A lookup that fails (LRCLIB busy or rate-limiting, no network)
//! is tried again after [`RETRY_DELAYS`] while the track plays. The lines go
//! out shifted by the user's offset for the track, kept in
//! `lyrics-offsets.toml`; the picks are kept in `lyrics-choices.toml`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::future::BoxFuture;
use tokio::sync::{mpsc, oneshot, watch};

use super::cache::Cache;
use super::choices::Choices;
use super::key::TrackKey;
use super::local;
use super::lrclib::{Alternative, Client, FetchError, Query};
use super::offsets::{self, Offsets};
use super::{Lookup, LyricsState, Status};
use crate::features::media::MediaState;
use crate::shared::fs::write_atomically;

/// Where lyrics come from. Implemented by the LRCLIB client; tests inject fakes.
pub trait LyricsSource: Send + Sync {
    fn lookup<'a>(&'a self, q: &'a Query) -> BoxFuture<'a, Result<Lookup, FetchError>>;
    /// Every version of the track's lyrics, for the user to pick from.
    fn alternatives<'a>(
        &'a self,
        q: &'a Query,
    ) -> BoxFuture<'a, Result<Vec<Alternative>, FetchError>>;
    /// The lyrics of one version, by its id.
    fn by_id(&self, id: i64) -> BoxFuture<'_, Result<Lookup, FetchError>>;
}

impl LyricsSource for Client {
    fn lookup<'a>(&'a self, q: &'a Query) -> BoxFuture<'a, Result<Lookup, FetchError>> {
        Box::pin(Client::lookup(self, q))
    }

    fn alternatives<'a>(
        &'a self,
        q: &'a Query,
    ) -> BoxFuture<'a, Result<Vec<Alternative>, FetchError>> {
        Box::pin(Client::alternatives(self, q))
    }

    fn by_id(&self, id: i64) -> BoxFuture<'_, Result<Lookup, FetchError>> {
        Box::pin(Client::by_id(self, id))
    }
}

/// How long to wait before each new try of a failed lookup.
pub const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(30),
    Duration::from_secs(2 * 60),
    Duration::from_secs(10 * 60),
];

/// A command with no track, or with lyrics off: there is nothing to keep it for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NoTrack;

/// Why `Search` gave no list.
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("no track to search lyrics for")]
    NoTrack,
    #[error(transparent)]
    Fetch(#[from] FetchError),
}

#[derive(Debug)]
pub enum Command {
    /// Sets the current track's offset; answers with the clamped value once
    /// it is published.
    SetOffset(i64, oneshot::Sender<Result<i64, NoTrack>>),
    /// Lists every version of the current track's lyrics, best first.
    Search(oneshot::Sender<Result<Vec<Alternative>, SearchError>>),
    /// Shows the version with this id for the current track from now on, 0
    /// or less for the lyrics Nokta finds itself; answers with the pick once
    /// it is published (loading, or the lyrics when they are known).
    Choose(i64, oneshot::Sender<Result<i64, NoTrack>>),
}

/// The service's commands and its published state.
pub struct Handle {
    pub state: watch::Receiver<LyricsState>,
    pub commands: mpsc::Sender<Command>,
}

/// Where the service reads and keeps lyrics.
pub struct Storage {
    pub cache: Cache,
    /// The user's own `.lrc` files.
    pub local_dir: PathBuf,
    pub offsets_file: PathBuf,
    pub choices_file: PathBuf,
}

pub fn spawn(
    media: watch::Receiver<MediaState>,
    enabled: watch::Receiver<bool>,
    storage: Storage,
    source: Arc<dyn LyricsSource>,
    retry: Vec<Duration>,
) -> Handle {
    let (tx, state) = watch::channel(LyricsState::default());
    let (commands, commands_rx) = mpsc::channel(8);
    let files = Files {
        cache: Arc::new(storage.cache),
        local_dir: storage.local_dir,
        offsets_file: storage.offsets_file,
        choices_file: storage.choices_file,
        retry: retry.into(),
    };
    tokio::spawn(run(media, enabled, commands_rx, files, source, tx));
    Handle { state, commands }
}

struct Files {
    cache: Arc<Cache>,
    local_dir: PathBuf,
    offsets_file: PathBuf,
    choices_file: PathBuf,
    retry: Arc<[Duration]>,
}

#[derive(Clone)]
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

/// The current track: what was found for it, unshifted, its offset, the
/// version the user picked (0 for none) and the last search's versions.
struct Current {
    request: Request,
    found: LyricsState,
    offset_ms: i64,
    choice: i64,
    alternatives: Vec<Alternative>,
}

/// A lookup's answer, for the track and pick it was started for.
type Done = (u64, LyricsState);

async fn run(
    mut media: watch::Receiver<MediaState>,
    mut enabled: watch::Receiver<bool>,
    mut commands: mpsc::Receiver<Command>,
    files: Files,
    source: Arc<dyn LyricsSource>,
    tx: watch::Sender<LyricsState>,
) {
    let mut offsets = load(&files.offsets_file, Offsets::parse).await;
    let mut choices = load(&files.choices_file, Choices::parse).await;
    let (done_tx, mut done_rx) = mpsc::unbounded_channel::<Done>();
    let (searched_tx, mut searched_rx) = mpsc::unbounded_channel::<(TrackKey, Vec<Alternative>)>();
    let mut current: Option<Current> = None;
    // Counts track changes and picks, so a lookup's answer or a retry knows
    // it is no longer wanted, even when the same track comes back.
    let (generation_tx, generation) = watch::channel(0u64);
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
        if wanted.as_ref().map(|r| &r.key) != current.as_ref().map(|c| &c.request.key) {
            generation_tx.send_modify(|g| *g += 1);
            current = match wanted {
                Some(request) => {
                    let track = request.key.offset_name();
                    let choice = choices.get(&track);
                    Some(Current {
                        offset_ms: offsets.get(&track),
                        found: start(&request, choice, &files, &source, &done_tx, &generation)
                            .await,
                        request,
                        choice,
                        alternatives: Vec::new(),
                    })
                }
                None => None,
            };
            publish(&tx, current.as_ref());
        }
        tokio::select! {
            changed = media.changed() => if changed.is_err() { break },
            changed = enabled.changed() => if changed.is_err() { break },
            Some((at, state)) = done_rx.recv() => {
                if let Some(c) = current.as_mut().filter(|_| at == *generation.borrow()) {
                    c.found = state;
                    publish(&tx, Some(c));
                }
            }
            Some((key, found)) = searched_rx.recv() => keep_search(current.as_mut(), key, found),
            Some(command) = commands.recv() => match command {
                Command::SetOffset(offset_ms, reply) => {
                    let Some(c) = current.as_mut() else {
                        let _ = reply.send(Err(NoTrack));
                        continue;
                    };
                    c.offset_ms = offsets.set(&c.request.key.offset_name(), offset_ms);
                    publish(&tx, Some(c));
                    save(&files.offsets_file, offsets.to_toml()).await;
                    let _ = reply.send(Ok(c.offset_ms));
                }
                Command::Search(reply) => {
                    let Some(c) = current.as_ref() else {
                        let _ = reply.send(Err(SearchError::NoTrack));
                        continue;
                    };
                    let (source, searched) = (source.clone(), searched_tx.clone());
                    let Request { key, query, .. } = c.request.clone();
                    tokio::spawn(async move {
                        let found = source.alternatives(&query).await;
                        if let Ok(list) = &found {
                            let _ = searched.send((key, list.clone()));
                        }
                        let _ = reply.send(found.map_err(SearchError::from));
                    });
                }
                Command::Choose(id, reply) => {
                    // The search the pick comes from has answered: keep its versions first.
                    while let Ok((key, found)) = searched_rx.try_recv() {
                        keep_search(current.as_mut(), key, found);
                    }
                    let Some(c) = current.as_mut() else {
                        let _ = reply.send(Err(NoTrack));
                        continue;
                    };
                    c.choice = choices.set(&c.request.key.offset_name(), id);
                    generation_tx.send_modify(|g| *g += 1);
                    let listed = c
                        .alternatives
                        .iter()
                        .find(|a| c.choice > 0 && a.id == c.choice)
                        .map(|a| a.lookup.clone());
                    c.found = match listed {
                        Some(lookup) => {
                            store(&files.cache, Fetch::Record(c.choice), lookup.clone()).await;
                            LyricsState::from(lookup)
                        }
                        None => {
                            start(&c.request, c.choice, &files, &source, &done_tx, &generation)
                                .await
                        }
                    };
                    publish(&tx, Some(c));
                    save(&files.choices_file, choices.to_toml()).await;
                    let _ = reply.send(Ok(c.choice));
                }
            },
        }
    }
}

/// Keeps a search's versions for a pick, while its track plays.
fn keep_search(current: Option<&mut Current>, key: TrackKey, found: Vec<Alternative>) {
    if let Some(c) = current.filter(|c| c.request.key == key) {
        c.alternatives = found;
    }
}

/// A saved file's contents; empty when the file is missing or broken.
async fn load<T: Default, E: std::fmt::Display>(
    file: &Path,
    parse: impl FnOnce(&str) -> Result<T, E>,
) -> T {
    match tokio::fs::read_to_string(file).await {
        Ok(text) => parse(&text).unwrap_or_else(|err| {
            tracing::warn!("ignoring {}: {err}", file.display());
            T::default()
        }),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => T::default(),
        Err(err) => {
            tracing::warn!(%err, "cannot read {}", file.display());
            T::default()
        }
    }
}

async fn save(file: &Path, text: String) {
    if let Err(err) = write_atomically(file, text).await {
        tracing::warn!(%err, "cannot write {}", file.display());
    }
}

/// What a lookup asks LRCLIB for: lyrics Nokta finds for the track, or the
/// version the user picked.
#[derive(Clone)]
enum Fetch {
    Track(TrackKey, Query),
    Record(i64),
}

impl Fetch {
    async fn run(&self, source: &dyn LyricsSource) -> Result<Lookup, FetchError> {
        match self {
            Fetch::Track(_, query) => source.lookup(query).await,
            Fetch::Record(id) => source.by_id(*id).await,
        }
    }
}

/// Keeps a lookup's answer in the cache, off the async runtime.
async fn store(cache: &Arc<Cache>, fetch: Fetch, lookup: Lookup) {
    let cache = cache.clone();
    let stored = tokio::task::spawn_blocking(move || match fetch {
        Fetch::Track(key, _) => cache.put(&key, &lookup, now_unix()),
        Fetch::Record(id) => cache.put_record(id, &lookup, now_unix()),
    })
    .await;
    if let Ok(Err(err)) = stored {
        tracing::warn!(%err, "cannot write the lyrics cache");
    }
}

/// What is known about the track right away: the picked version or else
/// the user's own lyrics, from the cache, or else loading while LRCLIB is
/// asked, again after each of `files.retry` until the track or the pick
/// changes (`generation` moves on).
async fn start(
    request: &Request,
    choice: i64,
    files: &Files,
    source: &Arc<dyn LyricsSource>,
    done: &mpsc::UnboundedSender<Done>,
    generation: &watch::Receiver<u64>,
) -> LyricsState {
    // The lyrics folder, a song's own folder and the cache can sit on a
    // slow disk or mount: read them off the async runtime.
    let (local_dir, cache, at) = (
        files.local_dir.clone(),
        files.cache.clone(),
        request.clone(),
    );
    let known = tokio::task::spawn_blocking(move || {
        if choice > 0 {
            cache.get_record(choice, now_unix()).map(LyricsState::from)
        } else {
            known(&local_dir, &cache, &at)
        }
    })
    .await;
    if let Ok(Some(state)) = known {
        return state;
    }
    let fetch = if choice > 0 {
        Fetch::Record(choice)
    } else {
        Fetch::Track(request.key.clone(), request.query.clone())
    };
    let (cache, source, done) = (files.cache.clone(), source.clone(), done.clone());
    let (retry, generation) = (files.retry.clone(), generation.clone());
    let mine = *generation.borrow();
    let title = request.query.title.clone();
    tokio::spawn(async move {
        let mut delays = retry.iter();
        loop {
            match fetch.run(source.as_ref()).await {
                Ok(lookup) => {
                    store(&cache, fetch.clone(), lookup.clone()).await;
                    let _ = done.send((mine, LyricsState::from(lookup)));
                    return;
                }
                Err(err) => {
                    tracing::info!(%err, %title, "lyrics lookup failed");
                    let error = LyricsState {
                        status: Status::Error,
                        ..LyricsState::default()
                    };
                    let _ = done.send((mine, error));
                }
            }
            let Some(delay) = delays.next() else { return };
            tokio::time::sleep(*delay).await;
            if *generation.borrow() != mine {
                return;
            }
        }
    });
    LyricsState {
        status: Status::Loading,
        ..LyricsState::default()
    }
}

/// The user's own lyrics for the track, else a cached answer; blocks on
/// the disk.
fn known(local_dir: &Path, cache: &Cache, request: &Request) -> Option<LyricsState> {
    let (query, url) = (&request.query, request.url.as_deref());
    if let Some(lines) = local::find(local_dir, url, &query.artist, &query.title) {
        return Some(LyricsState {
            status: Status::Synced,
            lines,
            ..LyricsState::default()
        });
    }
    cache.get(&request.key, now_unix()).map(LyricsState::from)
}

/// Publishes the current track's lyrics, shifted by its offset, or none.
fn publish(tx: &watch::Sender<LyricsState>, current: Option<&Current>) {
    let next = current.map_or_else(LyricsState::default, |c| LyricsState {
        status: c.found.status,
        lines: match c.found.status {
            // Plain lyrics have no timing to move.
            Status::Plain => c.found.lines.clone(),
            _ => offsets::shift(&c.found.lines, c.offset_ms),
        },
        offset_ms: c.offset_ms,
        choice: c.choice,
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

    /// A source whose lookups the test answers one by one; a search gives
    /// `versions`, and a version by id is looked up as its title `#id`.
    struct FakeSource {
        requests: mpsc::UnboundedSender<(Query, Reply)>,
        versions: Arc<std::sync::Mutex<Vec<Alternative>>>,
    }

    impl LyricsSource for FakeSource {
        fn lookup<'a>(&'a self, q: &'a Query) -> BoxFuture<'a, Result<Lookup, FetchError>> {
            let (reply, answer) = oneshot::channel();
            self.requests.send((q.clone(), reply)).unwrap();
            Box::pin(async move { answer.await.unwrap() })
        }

        fn alternatives<'a>(
            &'a self,
            _: &'a Query,
        ) -> BoxFuture<'a, Result<Vec<Alternative>, FetchError>> {
            let versions = self.versions.lock().unwrap().clone();
            Box::pin(async move { Ok(versions) })
        }

        fn by_id(&self, id: i64) -> BoxFuture<'_, Result<Lookup, FetchError>> {
            let q = Query {
                title: format!("#{id}"),
                ..Query::default()
            };
            let (reply, answer) = oneshot::channel();
            self.requests.send((q, reply)).unwrap();
            Box::pin(async move { answer.await.unwrap() })
        }
    }

    struct Harness {
        media: watch::Sender<MediaState>,
        enabled: watch::Sender<bool>,
        lyrics: watch::Receiver<LyricsState>,
        commands: mpsc::Sender<Command>,
        requests: Arc<Mutex<mpsc::UnboundedReceiver<(Query, Reply)>>>,
        versions: Arc<std::sync::Mutex<Vec<Alternative>>>,
        cache: Cache,
        _dir: Arc<tempfile::TempDir>,
    }

    fn start(enabled: bool) -> Harness {
        start_in(Arc::new(tempfile::tempdir().unwrap()), enabled)
    }

    /// Starts the service on the files in `dir`, as after a restart.
    fn start_in(dir: Arc<tempfile::TempDir>, enabled: bool) -> Harness {
        start_with(dir, enabled, Vec::new())
    }

    /// Starts the service with failed lookups tried again after `retry`.
    fn start_with(dir: Arc<tempfile::TempDir>, enabled: bool, retry: Vec<Duration>) -> Harness {
        let (media, media_rx) = watch::channel(MediaState::default());
        let (enabled_tx, enabled_rx) = watch::channel(enabled);
        let (req_tx, req_rx) = mpsc::unbounded_channel();
        let versions = Arc::new(std::sync::Mutex::new(Vec::new()));
        let source = Arc::new(FakeSource {
            requests: req_tx,
            versions: versions.clone(),
        });
        let storage = Storage {
            cache: Cache::new(dir.path().to_owned()),
            local_dir: dir.path().join("lyrics"),
            offsets_file: offsets_file(&dir),
            choices_file: choices_file(&dir),
        };
        let Handle { state, commands } = spawn(media_rx, enabled_rx, storage, source, retry);
        Harness {
            media,
            enabled: enabled_tx,
            lyrics: state,
            commands,
            requests: Arc::new(Mutex::new(req_rx)),
            versions,
            cache: Cache::new(dir.path().to_owned()),
            _dir: dir,
        }
    }

    fn offsets_file(dir: &tempfile::TempDir) -> std::path::PathBuf {
        dir.path().join("lyrics-offsets.toml")
    }

    fn choices_file(dir: &tempfile::TempDir) -> std::path::PathBuf {
        dir.path().join("lyrics-choices.toml")
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

        async fn search(&self) -> Result<Vec<Alternative>, SearchError> {
            let (done, answer) = oneshot::channel();
            self.commands.send(Command::Search(done)).await.unwrap();
            answer.await.unwrap()
        }

        async fn choose(&self, id: i64) -> Result<i64, NoTrack> {
            let (done, answer) = oneshot::channel();
            self.commands.send(Command::Choose(id, done)).await.unwrap();
            answer.await.unwrap()
        }

        fn chosen(&self) -> String {
            std::fs::read_to_string(choices_file(&self._dir)).unwrap_or_default()
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

    fn busy() -> FetchError {
        FetchError::Status(reqwest::StatusCode::TOO_MANY_REQUESTS)
    }

    fn retrying() -> Harness {
        let retry = vec![Duration::from_millis(20), Duration::from_millis(20)];
        start_with(Arc::new(tempfile::tempdir().unwrap()), true, retry)
    }

    #[tokio::test]
    async fn a_failed_lookup_is_tried_again() {
        let mut h = retrying();
        h.media.send_replace(playing("A"));
        let (_, reply) = h.next_request().await;
        reply.send(Err(busy())).unwrap();
        h.wait("error", |s| s.status == Status::Error).await;
        let (q, reply) = h.next_request().await;
        assert_eq!(q.title, "A");
        reply.send(Ok(synced("second try"))).unwrap();
        let s = h.wait("lyrics", |s| s.status == Status::Synced).await;
        assert_eq!(s.lines[0].text, "second try");
        assert_eq!(
            h.cache.get(&key("A"), now_unix()),
            Some(synced("second try"))
        );
    }

    #[tokio::test]
    async fn retries_stop_after_the_last_delay() {
        let mut h = retrying();
        h.media.send_replace(playing("A"));
        for _ in 0..3 {
            let (_, reply) = h.next_request().await;
            reply.send(Err(busy())).unwrap();
        }
        h.wait("error", |s| s.status == Status::Error).await;
        h.no_request().await;
    }

    #[tokio::test]
    async fn another_track_ends_the_retries() {
        let mut h = retrying();
        h.media.send_replace(playing("A"));
        let (_, reply) = h.next_request().await;
        h.media.send_replace(playing("B"));
        let (q, reply_b) = h.next_request().await;
        assert_eq!(q.title, "B");
        reply.send(Err(busy())).unwrap();
        reply_b.send(Ok(synced("b"))).unwrap();
        h.wait("B", |s| s.status == Status::Synced).await;
        h.no_request().await;
    }

    #[tokio::test]
    async fn a_track_that_comes_back_is_looked_up_once() {
        let retry = vec![Duration::from_millis(100)];
        let mut h = start_with(Arc::new(tempfile::tempdir().unwrap()), true, retry);
        h.media.send_replace(playing("A"));
        let (_, reply) = h.next_request().await;
        reply.send(Err(busy())).unwrap();
        h.wait("error", |s| s.status == Status::Error).await;
        h.media.send_replace(playing("B"));
        let (_, reply_b) = h.next_request().await;
        h.media.send_replace(playing("A"));
        let (q, reply_a) = h.next_request().await;
        assert_eq!(q.title, "A");
        tokio::time::sleep(Duration::from_millis(150)).await;
        h.no_request().await;
        drop((reply_b, reply_a));
    }

    #[tokio::test]
    async fn turning_lyrics_off_ends_the_retries() {
        // Long enough for the switch to land before the retry would.
        let retry = vec![Duration::from_millis(100)];
        let mut h = start_with(Arc::new(tempfile::tempdir().unwrap()), true, retry);
        h.media.send_replace(playing("A"));
        let (_, reply) = h.next_request().await;
        reply.send(Err(busy())).unwrap();
        h.wait("error", |s| s.status == Status::Error).await;
        h.enabled.send_replace(false);
        h.wait("none", |s| s.status == Status::None).await;
        tokio::time::sleep(Duration::from_millis(150)).await;
        h.no_request().await;
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
    async fn plain_lyrics_are_published_in_order_and_never_shifted() {
        let mut h = start(true);
        h.media.send_replace(playing("A"));
        let (_, reply) = h.next_request().await;
        reply
            .send(Ok(Lookup::Plain(vec!["one".into(), "two".into()])))
            .unwrap();
        let s = h.wait("plain", |s| s.status == Status::Plain).await;
        let texts: Vec<&str> = s.lines.iter().map(|l| l.text.as_str()).collect();
        assert_eq!((texts, starts(&s)), (vec!["one", "two"], vec![0, 0]));
        assert_eq!(h.set_offset(-1_000).await, Ok(-1_000));
        assert_eq!(starts(&h.lyrics.borrow()), [0, 0]);
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

    fn version(id: i64, text: &str) -> Alternative {
        Alternative {
            id,
            title: "A".into(),
            artist: "Artist".into(),
            album: String::new(),
            duration_ms: 200_000,
            synced: true,
            lookup: synced(text),
        }
    }

    fn first_text(state: &LyricsState) -> &str {
        state.lines.first().map_or("", |l| l.text.as_str())
    }

    #[tokio::test]
    async fn a_version_from_the_search_shows_at_once_and_stays_with_the_track() {
        let dir = Arc::new(tempfile::tempdir().unwrap());
        let mut h = start_in(dir.clone(), true);
        h.cache.put(&key("A"), &synced("auto"), now_unix()).unwrap();
        *h.versions.lock().unwrap() = vec![version(7, "seven"), version(9, "nine")];
        h.media.send_replace(playing("A"));
        h.wait("auto", |s| first_text(s) == "auto").await;

        let found = h.search().await.unwrap();
        assert_eq!(found.iter().map(|a| a.id).collect::<Vec<_>>(), [7, 9]);
        assert_eq!(h.choose(9).await, Ok(9));
        let s = h.lyrics.borrow().clone();
        assert_eq!((first_text(&s), s.choice), ("nine", 9));
        h.no_request().await;
        assert!(
            h.chosen()
                .contains(&format!("{} = 9", key("A").offset_name())),
            "{}",
            h.chosen()
        );

        // Another track and back, and after a restart: the pick, from the cache.
        h.cache.put(&key("B"), &synced("b"), now_unix()).unwrap();
        h.media.send_replace(playing("B"));
        let s = h.wait("B", |s| first_text(s) == "b").await;
        assert_eq!(s.choice, 0);
        drop(h);
        let mut h = start_in(dir, true);
        h.media.send_replace(playing("A"));
        let s = h.wait("the pick", |s| s.status == Status::Synced).await;
        assert_eq!((first_text(&s), s.choice), ("nine", 9));
        h.no_request().await;
    }

    #[tokio::test]
    async fn a_pick_not_listed_is_fetched_by_id_and_wins_over_a_local_file() {
        let mut h = start(true);
        let dir = h._dir.path().join("lyrics");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Artist - A.lrc"), "[00:03.00]mine\n").unwrap();
        h.media.send_replace(playing("A"));
        h.wait("local", |s| first_text(s) == "mine").await;

        assert_eq!(h.choose(42).await, Ok(42));
        assert_eq!(h.lyrics.borrow().status, Status::Loading);
        let (q, reply) = h.next_request().await;
        assert_eq!(q.title, "#42");
        reply.send(Ok(synced("forty-two"))).unwrap();
        h.wait("the pick", |s| first_text(s) == "forty-two").await;
        assert_eq!(
            h.cache.get_record(42, now_unix()),
            Some(synced("forty-two"))
        );

        assert_eq!(h.choose(0).await, Ok(0));
        let s = h.lyrics.borrow().clone();
        assert_eq!((first_text(&s), s.choice), ("mine", 0));
        assert!(
            !h.chosen().contains(&key("A").offset_name()),
            "{}",
            h.chosen()
        );
    }

    #[tokio::test]
    async fn a_late_answer_for_the_automatic_lyrics_does_not_replace_a_pick() {
        let h = start(true);
        *h.versions.lock().unwrap() = vec![version(7, "seven")];
        h.media.send_replace(playing("A"));
        let (_, reply) = h.next_request().await;
        h.search().await.unwrap();
        assert_eq!(h.choose(7).await, Ok(7));
        reply.send(Ok(synced("auto"))).unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(first_text(&h.lyrics.borrow()), "seven");
    }

    #[tokio::test]
    async fn without_a_track_there_is_nothing_to_search_or_choose() {
        let h = start(true);
        assert!(matches!(h.search().await, Err(SearchError::NoTrack)));
        assert_eq!(h.choose(7).await, Err(NoTrack));
        assert_eq!(h.chosen(), "");
    }
}
