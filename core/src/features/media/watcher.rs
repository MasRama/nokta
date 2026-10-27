//! Follows every MPRIS player on the session bus and publishes the state of
//! the active one.
//!
//! One actor task owns all player state. Per-player tasks only forward D-Bus
//! signals, and slow player calls (reading `Position`, resolving art) run in
//! their own tasks, so a hung player never stalls the others.

use std::collections::{HashMap, HashSet};

use futures_util::StreamExt;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use zbus::fdo::{DBusProxy, PropertiesProxy};
use zbus::names::InterfaceName;
use zbus::proxy::CacheProperties;
use zbus::zvariant::{OwnedValue, Value};
use zbus::{Connection, MatchRule, MessageStream};

use super::art::{ArtCache, ArtInfo};
use super::control::Controller;
use super::mpris::{PlayerProxy, RootProxy, NAME_PREFIX, PATH, PLAYER_INTERFACE};
use super::{MediaState, PlaybackStatus, Selector, Track};
use crate::shared::clock::monotonic_us;

type Props = HashMap<String, OwnedValue>;

pub(super) enum Event {
    NameOwner {
        name: String,
        old: Option<String>,
        new: Option<String>,
    },
    Added {
        unique: String,
        identity: String,
        proxy: PlayerProxy<'static>,
        props: Props,
    },
    Props {
        unique: String,
        props: Props,
    },
    Seeked {
        unique: String,
        position_us: i64,
    },
    Position {
        unique: String,
        generation: u64,
        position_us: i64,
        timestamp_us: i64,
    },
    Art {
        unique: String,
        url: String,
        info: Option<ArtInfo>,
    },
    Refresh,
    Active(oneshot::Sender<Option<Active>>),
}

/// What the controller needs to act on the active player.
pub(super) struct Active {
    pub proxy: PlayerProxy<'static>,
    pub track_id: Option<String>,
    pub can_seek: bool,
    pub length_us: i64,
}

pub fn spawn(conn: Connection, art: ArtCache) -> (watch::Receiver<MediaState>, Controller) {
    let (state, state_rx) = watch::channel(MediaState::default());
    let (tx, rx) = mpsc::unbounded_channel();
    let actor = Actor {
        conn,
        art,
        tx: tx.clone(),
        state,
        slots: HashMap::new(),
        selector: Selector::default(),
    };
    tokio::spawn(actor.run(rx));
    (state_rx, Controller::new(tx))
}

/// One D-Bus connection (unique name) that owns one or more MPRIS names.
struct Slot {
    names: HashSet<String>,
    task: JoinHandle<()>,
    player: Option<Player>,
}

struct Player {
    proxy: PlayerProxy<'static>,
    identity: String,
    status: PlaybackStatus,
    track: Track,
    rate: f64,
    // Raw MPRIS flags; to_state() derives the io.nokta.Media1 capabilities.
    can_play: bool,
    can_pause: bool,
    can_control: bool,
    can_go_next: bool,
    can_go_previous: bool,
    can_seek: bool,
    position_us: i64,
    position_timestamp_us: i64,
    /// Bumped on every new position source so a slow read cannot overwrite a newer one.
    position_generation: u64,
    art_path: String,
    accent_color: String,
}

#[derive(Default)]
struct Changes {
    refresh_position: bool,
    resolve_art: bool,
}

impl Player {
    fn new(proxy: PlayerProxy<'static>, identity: String) -> Player {
        Player {
            proxy,
            identity,
            status: PlaybackStatus::Stopped,
            track: Track::default(),
            rate: 1.0,
            can_play: false,
            can_pause: false,
            // Players that omit CanControl are assumed controllable.
            can_control: true,
            can_go_next: false,
            can_go_previous: false,
            can_seek: false,
            position_us: 0,
            position_timestamp_us: monotonic_us(),
            position_generation: 0,
            art_path: String::new(),
            accent_color: String::new(),
        }
    }

    /// Moves the snapshot to `now`, so a status or rate change does not make
    /// the extension extrapolate from a stale point under the new rules.
    fn rebase(&mut self, now: i64) {
        if self.status == PlaybackStatus::Playing {
            let elapsed = (now - self.position_timestamp_us).max(0) as f64 * self.rate;
            self.position_us += elapsed as i64;
            if self.track.length_us > 0 {
                self.position_us = self.position_us.min(self.track.length_us);
            }
        }
        self.position_timestamp_us = now;
    }

    fn set_position(&mut self, position_us: i64, now: i64) {
        self.position_generation += 1;
        self.position_us = position_us.max(0);
        self.position_timestamp_us = now;
    }

    fn apply(&mut self, props: &Props, now: i64) -> Changes {
        let mut changes = Changes::default();
        for (key, value) in props {
            match (key.as_str(), &**value) {
                ("PlaybackStatus", Value::Str(s)) => {
                    let status = PlaybackStatus::from_mpris(s.as_str());
                    if status != self.status {
                        self.rebase(now);
                        self.status = status;
                        changes.refresh_position = true;
                    }
                }
                ("Rate", Value::F64(rate)) if *rate != self.rate => {
                    self.rebase(now);
                    self.rate = *rate;
                    changes.refresh_position = true;
                }
                ("Metadata", _) => {
                    let map = value.try_clone().ok().and_then(|v| Props::try_from(v).ok());
                    let track = Track::from_metadata(&map.unwrap_or_default());
                    if track.identity() != self.track.identity() {
                        self.set_position(0, now);
                        changes.refresh_position = true;
                    }
                    if track.art_url != self.track.art_url {
                        self.art_path.clear();
                        self.accent_color.clear();
                        changes.resolve_art = track.art_url.is_some();
                    }
                    self.track = track;
                }
                ("Position", Value::I64(p)) => self.set_position(*p, now),
                ("CanPlay", Value::Bool(b)) => self.can_play = *b,
                ("CanPause", Value::Bool(b)) => self.can_pause = *b,
                ("CanControl", Value::Bool(b)) => self.can_control = *b,
                ("CanGoNext", Value::Bool(b)) => self.can_go_next = *b,
                ("CanGoPrevious", Value::Bool(b)) => self.can_go_previous = *b,
                ("CanSeek", Value::Bool(b)) => self.can_seek = *b,
                _ => {}
            }
        }
        changes
    }

    fn to_state(&self) -> MediaState {
        MediaState {
            available: true,
            player_name: self.identity.clone(),
            status: self.status,
            track: self.track.clone(),
            art_path: self.art_path.clone(),
            accent_color: self.accent_color.clone(),
            position_us: self.position_us,
            position_timestamp_us: self.position_timestamp_us,
            rate: self.rate,
            // MPRIS has no CanPlayPause: the toggle needs CanPause while
            // playing and CanPlay otherwise, and CanControl gates everything.
            can_play_pause: self.can_control
                && if self.status == PlaybackStatus::Playing {
                    self.can_pause
                } else {
                    self.can_play
                },
            can_go_next: self.can_control && self.can_go_next,
            can_go_previous: self.can_control && self.can_go_previous,
            can_seek: self.can_control && self.can_seek,
        }
    }
}

struct Actor {
    conn: Connection,
    art: ArtCache,
    tx: mpsc::UnboundedSender<Event>,
    state: watch::Sender<MediaState>,
    slots: HashMap<String, Slot>,
    selector: Selector,
}

impl Actor {
    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Event>) {
        if let Err(err) = self.discover().await {
            tracing::warn!(%err, "cannot list MPRIS players");
        }
        while let Some(event) = rx.recv().await {
            self.handle(event);
            self.publish();
        }
    }

    /// Subscribes to name changes first, then lists the players already present.
    async fn discover(&mut self) -> zbus::Result<()> {
        let rule = MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .sender("org.freedesktop.DBus")?
            .interface("org.freedesktop.DBus")?
            .member("NameOwnerChanged")?
            .arg0ns(NAME_PREFIX)?
            .build();
        let mut stream = MessageStream::for_match_rule(rule, &self.conn, None).await?;
        let tx = self.tx.clone();
        tokio::spawn(async move {
            while let Some(Ok(msg)) = stream.next().await {
                let Ok((name, old, new)) = msg.body().deserialize::<(String, String, String)>()
                else {
                    continue;
                };
                let some = |s: String| (!s.is_empty()).then_some(s);
                if tx
                    .send(Event::NameOwner {
                        name,
                        old: some(old),
                        new: some(new),
                    })
                    .is_err()
                {
                    break;
                }
            }
        });

        let dbus = DBusProxy::new(&self.conn).await?;
        for name in dbus.list_names().await? {
            if !is_player_name(name.as_str()) {
                continue;
            }
            if let Ok(owner) = dbus.get_name_owner(name.as_ref()).await {
                self.add_name(owner.to_string(), name.to_string());
            }
        }
        Ok(())
    }

    fn handle(&mut self, event: Event) {
        let now = monotonic_us();
        match event {
            Event::NameOwner { name, old, new } => {
                if !is_player_name(&name) {
                    return;
                }
                if let Some(old) = old {
                    self.remove_name(&old, &name);
                }
                if let Some(new) = new {
                    self.add_name(new, name);
                }
            }
            Event::Added {
                unique,
                identity,
                proxy,
                props,
            } => {
                let Some(slot) = self.slots.get_mut(&unique) else {
                    return;
                };
                let mut player = Player::new(proxy, identity);
                let changes = player.apply(&props, now);
                self.selector.set_status(&unique, player.status);
                slot.player = Some(player);
                self.follow_up(&unique, changes);
            }
            Event::Props { unique, props } => {
                let Some(player) = self.player_mut(&unique) else {
                    return;
                };
                let changes = player.apply(&props, now);
                let status = player.status;
                self.selector.set_status(&unique, status);
                self.follow_up(&unique, changes);
            }
            Event::Seeked {
                unique,
                position_us,
            } => {
                if let Some(player) = self.player_mut(&unique) {
                    player.set_position(position_us, now);
                }
            }
            Event::Position {
                unique,
                generation,
                position_us,
                timestamp_us,
            } => {
                if let Some(player) = self.player_mut(&unique) {
                    if player.position_generation == generation {
                        player.position_us = position_us.max(0);
                        player.position_timestamp_us = timestamp_us;
                    }
                }
            }
            Event::Art { unique, url, info } => {
                let Some(player) = self.player_mut(&unique) else {
                    return;
                };
                if player.track.art_url.as_deref() != Some(url.as_str()) {
                    return;
                }
                if let Some(info) = info {
                    player.art_path = info.path.to_string_lossy().into_owned();
                    player.accent_color = info.accent.unwrap_or_default();
                }
            }
            Event::Refresh => {
                if let Some(unique) = self.selector.active().map(str::to_owned) {
                    self.request_position(&unique);
                }
            }
            Event::Active(reply) => {
                let active = self.active_player().map(|p| Active {
                    proxy: p.proxy.clone(),
                    track_id: p.track.track_id.clone(),
                    can_seek: p.can_seek,
                    length_us: p.track.length_us,
                });
                let _ = reply.send(active);
            }
        }
    }

    fn player_mut(&mut self, unique: &str) -> Option<&mut Player> {
        self.slots.get_mut(unique)?.player.as_mut()
    }

    fn active_player(&self) -> Option<&Player> {
        self.slots.get(self.selector.active()?)?.player.as_ref()
    }

    fn add_name(&mut self, unique: String, name: String) {
        if let Some(slot) = self.slots.get_mut(&unique) {
            slot.names.insert(name);
            return;
        }
        let task = tokio::spawn(follow(self.conn.clone(), unique.clone(), self.tx.clone()));
        self.slots.insert(
            unique,
            Slot {
                names: HashSet::from([name]),
                task,
                player: None,
            },
        );
    }

    fn remove_name(&mut self, unique: &str, name: &str) {
        let Some(slot) = self.slots.get_mut(unique) else {
            return;
        };
        slot.names.remove(name);
        if slot.names.is_empty() {
            slot.task.abort();
            self.slots.remove(unique);
            self.selector.remove(unique);
        }
    }

    fn follow_up(&mut self, unique: &str, changes: Changes) {
        if changes.refresh_position {
            self.request_position(unique);
        }
        if changes.resolve_art {
            self.request_art(unique);
        }
    }

    fn request_position(&mut self, unique: &str) {
        let Some(player) = self.player_mut(unique) else {
            return;
        };
        player.position_generation += 1;
        let generation = player.position_generation;
        let proxy = player.proxy.clone();
        let tx = self.tx.clone();
        let unique = unique.to_owned();
        tokio::spawn(async move {
            match proxy.position().await {
                Ok(position_us) => {
                    let timestamp_us = monotonic_us();
                    let _ = tx.send(Event::Position {
                        unique,
                        generation,
                        position_us,
                        timestamp_us,
                    });
                }
                Err(err) => tracing::debug!(%unique, %err, "cannot read player position"),
            }
        });
    }

    fn request_art(&mut self, unique: &str) {
        let Some(url) = self
            .player_mut(unique)
            .and_then(|p| p.track.art_url.clone())
        else {
            return;
        };
        let art = self.art.clone();
        let tx = self.tx.clone();
        let unique = unique.to_owned();
        tokio::spawn(async move {
            let info = art.resolve(&url).await;
            let _ = tx.send(Event::Art { unique, url, info });
        });
    }

    fn publish(&self) {
        let next = self
            .active_player()
            .map(Player::to_state)
            .unwrap_or_default();
        self.state.send_if_modified(|current| {
            if *current == next {
                return false;
            }
            *current = next;
            true
        });
    }
}

fn is_player_name(name: &str) -> bool {
    name.strip_prefix(NAME_PREFIX)
        .is_some_and(|rest| rest.starts_with('.'))
}

/// Reads a player's initial state, then forwards its signals until it vanishes.
async fn follow(conn: Connection, unique: String, tx: mpsc::UnboundedSender<Event>) {
    if let Err(err) = follow_inner(&conn, &unique, &tx).await {
        tracing::debug!(%unique, %err, "stopped following MPRIS player");
    }
}

async fn follow_inner(
    conn: &Connection,
    unique: &str,
    tx: &mpsc::UnboundedSender<Event>,
) -> zbus::Result<()> {
    let interface = InterfaceName::from_static_str_unchecked(PLAYER_INTERFACE);
    let props = PropertiesProxy::builder(conn)
        .destination(unique.to_owned())?
        .path(PATH)?
        .cache_properties(CacheProperties::No)
        .build()
        .await?;
    let proxy = PlayerProxy::builder(conn)
        .destination(unique.to_owned())?
        .cache_properties(CacheProperties::No)
        .build()
        .await?;
    // Subscribe before reading, so no change between the two is lost.
    let mut changed = props.receive_properties_changed().await?;
    let mut seeked = proxy.receive_seeked().await?;
    let all = props.get_all(interface.clone()).await?;
    let identity = match RootProxy::builder(conn)
        .destination(unique.to_owned())?
        .cache_properties(CacheProperties::No)
        .build()
        .await
    {
        Ok(root) => root.identity().await.unwrap_or_default(),
        Err(_) => String::new(),
    };
    let unique = unique.to_owned();
    let added = Event::Added {
        unique: unique.clone(),
        identity,
        proxy,
        props: all,
    };
    if tx.send(added).is_err() {
        return Ok(());
    }

    loop {
        tokio::select! {
            Some(signal) = changed.next() => {
                let Ok(args) = signal.args() else { continue };
                if args.interface_name() != &interface {
                    continue;
                }
                let mut changed_props: Props = args
                    .changed_properties()
                    .iter()
                    .filter_map(|(k, v)| Some(((*k).to_owned(), v.try_to_owned().ok()?)))
                    .collect();
                if !args.invalidated_properties().is_empty() {
                    changed_props = props.get_all(interface.clone()).await?;
                }
                if tx.send(Event::Props { unique: unique.clone(), props: changed_props }).is_err() {
                    break;
                }
            }
            Some(signal) = seeked.next() => {
                let Ok(args) = signal.args() else { continue };
                let event = Event::Seeked { unique: unique.clone(), position_us: args.position };
                if tx.send(event).is_err() {
                    break;
                }
            }
            else => break,
        }
    }
    Ok(())
}
