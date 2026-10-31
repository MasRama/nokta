//! Windows media players: the system media transport controls (GSMTC) that
//! every player feeding Windows' own media flyout fills in. A thread follows
//! the sessions and their changes, publishes the media state the same way
//! the MPRIS watcher does on Linux, and runs the player commands.

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

use tokio::sync::watch;
use windows::core::HSTRING;
use windows::ApplicationModel::AppInfo;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as GsmtcSession,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::Storage::Streams::{Buffer, DataReader, InputStreamOptions};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use super::art::{ArtCache, ArtInfo, MAX_DOWNLOAD_BYTES};
use super::session::{self, Command, Session};
use super::{MediaState, Selector};
use crate::shared::clock::{monotonic_us, wall_us};

enum Message {
    Changed,
    Command(Command),
}

/// Sends commands to the media thread.
#[derive(Clone)]
pub struct Controller {
    tx: mpsc::Sender<Message>,
}

impl Controller {
    pub fn send(&self, command: Command) {
        let _ = self.tx.send(Message::Command(command));
    }
}

/// Quiet changes are read at once; a burst of them only once it calms down.
const SETTLE: Duration = Duration::from_millis(60);
/// Players do not always say when they seek: the state is read this often anyway.
const POLL: Duration = Duration::from_secs(5);

/// Follows Windows' media sessions; `runtime` runs the cover work.
pub fn spawn(
    art: ArtCache,
    runtime: tokio::runtime::Handle,
) -> (watch::Receiver<MediaState>, Controller) {
    let (state, receiver) = watch::channel(MediaState::default());
    let (tx, rx) = mpsc::channel();
    let events = tx.clone();
    let spawned = std::thread::Builder::new()
        .name("nokta-media".into())
        .spawn(move || {
            if let Err(err) = run(&rx, &events, &state, &art, &runtime) {
                tracing::warn!("no Windows media sessions: {err}");
            }
        });
    if let Err(err) = spawned {
        tracing::error!("cannot follow media players: {err}");
    }
    (receiver, Controller { tx })
}

struct Followed {
    session: GsmtcSession,
    tokens: [i64; 3],
}

struct Media {
    manager: Manager,
    followed: Vec<Followed>,
    selector: Selector,
    known: Vec<String>,
    /// The cover of the active track, and which track it is for.
    art: Option<ArtInfo>,
    art_key: String,
    /// Each app's name, looked up once.
    names: HashMap<String, String>,
}

fn run(
    rx: &mpsc::Receiver<Message>,
    events: &mpsc::Sender<Message>,
    state: &watch::Sender<MediaState>,
    art: &ArtCache,
    runtime: &tokio::runtime::Handle,
) -> windows::core::Result<()> {
    // SAFETY: once, on this thread, before any WinRT call.
    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let manager = Manager::RequestAsync()?.join()?;
    manager.SessionsChanged(&on_change(events))?;
    let mut media = Media {
        manager,
        followed: Vec::new(),
        selector: Selector::default(),
        known: Vec::new(),
        art: None,
        art_key: String::new(),
        names: HashMap::new(),
    };
    media.follow(events);
    media.publish(state, art, runtime);
    loop {
        let message = match rx.recv_timeout(POLL) {
            Ok(message) => message,
            Err(mpsc::RecvTimeoutError::Timeout) => Message::Changed,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
        };
        let mut changed = false;
        let mut sessions_changed = false;
        let mut handle = |message: Message, media: &mut Media| match message {
            Message::Changed => {
                changed = true;
                sessions_changed = true;
            }
            Message::Command(command) => {
                if let Err(err) = media.run(&command) {
                    tracing::debug!(?command, "the player refused: {err}");
                }
                changed = true;
            }
        };
        handle(message, &mut media);
        while let Ok(message) = rx.recv_timeout(SETTLE) {
            handle(message, &mut media);
        }
        if sessions_changed {
            media.follow(events);
        }
        if changed {
            media.publish(state, art, runtime);
        }
    }
}

impl Media {
    /// Follows the changes of every session there is now.
    fn follow(&mut self, events: &mpsc::Sender<Message>) {
        for old in self.followed.drain(..) {
            let [media, playback, timeline] = old.tokens;
            let _ = old.session.RemoveMediaPropertiesChanged(media);
            let _ = old.session.RemovePlaybackInfoChanged(playback);
            let _ = old.session.RemoveTimelinePropertiesChanged(timeline);
        }
        let Ok(sessions) = self.manager.GetSessions() else {
            return;
        };
        for session in sessions {
            let tokens = (|| -> windows::core::Result<[i64; 3]> {
                Ok([
                    session.MediaPropertiesChanged(&on_change(events))?,
                    session.PlaybackInfoChanged(&on_change(events))?,
                    session.TimelinePropertiesChanged(&on_change(events))?,
                ])
            })();
            match tokens {
                Ok(tokens) => self.followed.push(Followed { session, tokens }),
                Err(err) => tracing::debug!("cannot follow a media session: {err}"),
            }
        }
    }

    fn publish(
        &mut self,
        state: &watch::Sender<MediaState>,
        art: &ArtCache,
        runtime: &tokio::runtime::Handle,
    ) {
        let (handles, sessions): (Vec<&GsmtcSession>, Vec<Session>) = self
            .followed
            .iter()
            .filter_map(|f| Some((&f.session, read(&f.session).ok()?)))
            .unzip();
        session::track_sessions(&mut self.selector, &sessions, &mut self.known);
        let active = self
            .selector
            .active()
            .and_then(|id| sessions.iter().position(|s| s.id == id));
        match active {
            Some(index) => {
                let s = &sessions[index];
                let key = format!("{}\n{}\n{}\n{}", s.id, s.title, s.artist, s.album);
                if key != self.art_key || self.art.is_none() {
                    self.art = thumbnail(handles[index])
                        .and_then(|bytes| runtime.block_on(art.store(&bytes)));
                    self.art_key = key;
                }
            }
            None => {
                self.art = None;
                self.art_key.clear();
            }
        }
        let names = &mut self.names;
        let next = session::media_state(
            &self.selector,
            &sessions,
            |id| {
                names
                    .entry(id.to_owned())
                    .or_insert_with(|| app_name(id))
                    .clone()
            },
            self.art.as_ref(),
            wall_us(),
            monotonic_us(),
        );
        state.send_if_modified(|current| {
            if *current == next {
                return false;
            }
            *current = next;
            true
        });
    }

    fn active(&self) -> Option<&GsmtcSession> {
        let id = self.selector.active()?;
        self.followed.iter().map(|f| &f.session).find(|s| {
            s.SourceAppUserModelId()
                .is_ok_and(|a| a.to_string_lossy() == id)
        })
    }

    fn run(&mut self, command: &Command) -> windows::core::Result<()> {
        if let Command::Select(id) = command {
            self.selector.select(id);
            return Ok(());
        }
        if *command == Command::Refresh {
            return Ok(());
        }
        let Some(session) = self.active() else {
            return Ok(());
        };
        let done = match command {
            Command::PlayPause => session.TryTogglePlayPauseAsync()?.join()?,
            Command::Next => session.TrySkipNextAsync()?.join()?,
            Command::Previous => session.TrySkipPreviousAsync()?.join()?,
            Command::SetPosition(us) => {
                let start = session.GetTimelineProperties()?.StartTime()?.Duration;
                session
                    .TryChangePlaybackPositionAsync(start + us * 10)?
                    .join()?
            }
            Command::SetShuffle(on) => session.TryChangeShuffleActiveAsync(*on)?.join()?,
            Command::SetLoop(status) => session
                .TryChangeAutoRepeatModeAsync(MediaPlaybackAutoRepeatMode(session::gsmtc_loop(
                    *status,
                )))?
                .join()?,
            Command::Select(_) | Command::Refresh => true,
        };
        if !done {
            tracing::debug!(?command, "the player did not do it");
        }
        Ok(())
    }
}

/// A handler that only says something changed.
fn on_change<S, A>(events: &mpsc::Sender<Message>) -> TypedEventHandler<S, A>
where
    S: windows::core::RuntimeType + 'static,
    A: windows::core::RuntimeType + 'static,
{
    let tx = events.clone();
    TypedEventHandler::new(move |_, _| {
        let _ = tx.send(Message::Changed);
        Ok(())
    })
}

/// One session as plain data.
fn read(s: &GsmtcSession) -> windows::core::Result<Session> {
    let id = s.SourceAppUserModelId()?.to_string_lossy();
    let playback = s.GetPlaybackInfo()?;
    let controls = playback.Controls()?;
    let timeline = s.GetTimelineProperties()?;
    // Some apps fail to give their track while they change it.
    let props = s.TryGetMediaPropertiesAsync()?.join().ok();
    let text = |value: windows::core::Result<HSTRING>| {
        value.map(|v| v.to_string_lossy()).unwrap_or_default()
    };
    Ok(Session {
        id,
        status: session::status_from_gsmtc(playback.PlaybackStatus()?.0),
        title: props.as_ref().map(|p| text(p.Title())).unwrap_or_default(),
        artist: props.as_ref().map(|p| text(p.Artist())).unwrap_or_default(),
        album: props
            .as_ref()
            .map(|p| text(p.AlbumTitle()))
            .unwrap_or_default(),
        start_us: timeline.StartTime()?.Duration / 10,
        end_us: timeline.EndTime()?.Duration / 10,
        position_us: timeline.Position()?.Duration / 10,
        updated_unix_us: session::unix_us_from_ticks(timeline.LastUpdatedTime()?.UniversalTime),
        rate: playback.PlaybackRate().and_then(|r| r.Value()).ok(),
        shuffle: playback.IsShuffleActive().and_then(|r| r.Value()).ok(),
        repeat: playback
            .AutoRepeatMode()
            .and_then(|r| r.Value())
            .ok()
            .and_then(|mode| session::loop_from_gsmtc(mode.0)),
        can_play_pause: controls.IsPlayPauseToggleEnabled()?
            || controls.IsPlayEnabled()?
            || controls.IsPauseEnabled()?,
        can_go_next: controls.IsNextEnabled()?,
        can_go_previous: controls.IsPreviousEnabled()?,
        can_seek: controls.IsPlaybackPositionEnabled()?,
    })
}

/// The session's cover as the bytes of an image file.
fn thumbnail(s: &GsmtcSession) -> Option<Vec<u8>> {
    let read = || -> windows::core::Result<Vec<u8>> {
        let props = s.TryGetMediaPropertiesAsync()?.join()?;
        let stream = props.Thumbnail()?.OpenReadAsync()?.join()?;
        let size = u32::try_from(stream.Size()?.min(MAX_DOWNLOAD_BYTES as u64)).unwrap_or(0);
        let buffer = Buffer::Create(size)?;
        let filled = stream
            .ReadAsync(&buffer, size, InputStreamOptions::None)?
            .join()?;
        let mut bytes = vec![0; filled.Length()? as usize];
        DataReader::FromBuffer(&filled)?.ReadBytes(&mut bytes)?;
        Ok(bytes)
    };
    read().ok().filter(|bytes| !bytes.is_empty())
}

/// The app's own name from Windows, else one made from its id.
fn app_name(id: &str) -> String {
    AppInfo::GetFromAppUserModelId(&HSTRING::from(id))
        .and_then(|info| info.DisplayInfo())
        .and_then(|display| display.DisplayName())
        .map(|name| name.to_string_lossy())
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| session::player_name(id))
}
