use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use zbus::object_server::SignalEmitter;
use zbus::zvariant::{ObjectPath, OwnedValue, Value};

const PATH: &str = "/org/mpris/MediaPlayer2";

struct Root {
    identity: String,
}

#[zbus::interface(name = "org.mpris.MediaPlayer2")]
impl Root {
    #[zbus(property)]
    fn identity(&self) -> String {
        self.identity.clone()
    }
}

#[derive(Clone, Debug)]
pub struct Meta {
    pub track_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: String,
    pub length_us: i64,
}

impl Meta {
    pub fn new(n: u32) -> Meta {
        Meta {
            track_id: format!("/org/nokta/track/{n}"),
            title: format!("Song {n}"),
            artists: vec!["Artist".into()],
            album: format!("Album {n}"),
            length_us: 200_000_000,
        }
    }
}

/// MPRIS CanPlay, CanPause and CanControl.
#[derive(Clone, Copy)]
pub struct Caps {
    pub play: bool,
    pub pause: bool,
    pub control: bool,
}

impl Caps {
    pub const ALL: Caps = Caps {
        play: true,
        pause: true,
        control: true,
    };
}

struct Player {
    status: String,
    meta: Meta,
    position: i64,
    caps: Caps,
    calls: Arc<Mutex<Vec<String>>>,
}

fn owned(v: Value<'_>) -> OwnedValue {
    v.try_to_owned().unwrap()
}

#[zbus::interface(name = "org.mpris.MediaPlayer2.Player")]
impl Player {
    fn play_pause(&self) {
        self.calls.lock().unwrap().push("PlayPause".into());
    }
    fn next(&self) {
        self.calls.lock().unwrap().push("Next".into());
    }
    fn previous(&self) {
        self.calls.lock().unwrap().push("Previous".into());
    }
    fn set_position(&self, track_id: ObjectPath<'_>, position: i64) {
        self.calls
            .lock()
            .unwrap()
            .push(format!("SetPosition {track_id} {position}"));
    }

    #[zbus(signal)]
    async fn seeked(emitter: &SignalEmitter<'_>, position: i64) -> zbus::Result<()>;

    #[zbus(property)]
    fn playback_status(&self) -> String {
        self.status.clone()
    }
    #[zbus(property)]
    fn metadata(&self) -> HashMap<String, OwnedValue> {
        let m = &self.meta;
        HashMap::from([
            (
                "mpris:trackid".into(),
                owned(ObjectPath::try_from(m.track_id.as_str()).unwrap().into()),
            ),
            ("xesam:title".into(), owned(m.title.as_str().into())),
            ("xesam:artist".into(), owned(m.artists.clone().into())),
            ("xesam:album".into(), owned(m.album.as_str().into())),
            ("mpris:length".into(), owned(m.length_us.into())),
        ])
    }
    #[zbus(property(emits_changed_signal = "false"))]
    fn position(&self) -> i64 {
        self.position
    }
    #[zbus(property)]
    fn rate(&self) -> f64 {
        1.0
    }
    #[zbus(property)]
    fn can_play(&self) -> bool {
        self.caps.play
    }
    #[zbus(property)]
    fn can_pause(&self) -> bool {
        self.caps.pause
    }
    #[zbus(property)]
    fn can_control(&self) -> bool {
        self.caps.control
    }
    #[zbus(property)]
    fn can_go_next(&self) -> bool {
        self.caps.control
    }
    #[zbus(property)]
    fn can_go_previous(&self) -> bool {
        self.caps.control
    }
    #[zbus(property)]
    fn can_seek(&self) -> bool {
        self.caps.control
    }
}

/// A player that also has MPRIS Shuffle and LoopStatus, both writable.
struct LoopingPlayer {
    meta: Meta,
    shuffle: bool,
    loop_status: String,
    calls: Arc<Mutex<Vec<String>>>,
}

#[zbus::interface(name = "org.mpris.MediaPlayer2.Player")]
impl LoopingPlayer {
    #[zbus(property)]
    fn playback_status(&self) -> String {
        "Playing".into()
    }
    #[zbus(property)]
    fn metadata(&self) -> HashMap<String, OwnedValue> {
        HashMap::from([("xesam:title".into(), owned(self.meta.title.as_str().into()))])
    }
    #[zbus(property(emits_changed_signal = "false"))]
    fn position(&self) -> i64 {
        0
    }
    #[zbus(property)]
    fn can_control(&self) -> bool {
        true
    }
    #[zbus(property)]
    fn shuffle(&self) -> bool {
        self.shuffle
    }
    #[zbus(property)]
    fn set_shuffle(&mut self, shuffle: bool) {
        self.calls
            .lock()
            .unwrap()
            .push(format!("Shuffle {shuffle}"));
        self.shuffle = shuffle;
    }
    #[zbus(property)]
    fn loop_status(&self) -> String {
        self.loop_status.clone()
    }
    #[zbus(property)]
    fn set_loop_status(&mut self, status: String) {
        self.calls
            .lock()
            .unwrap()
            .push(format!("LoopStatus {status}"));
        self.loop_status = status;
    }
}

/// A fake MPRIS player on its own connection. Closing it makes the player vanish.
pub struct FakePlayer {
    pub conn: zbus::Connection,
    pub calls: Arc<Mutex<Vec<String>>>,
}

impl FakePlayer {
    pub async fn start(address: &str, name: &str, status: &str, meta: Meta) -> FakePlayer {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let player = Player {
            status: status.into(),
            meta,
            position: 0,
            caps: Caps::ALL,
            calls: calls.clone(),
        };
        let conn = zbus::connection::Builder::address(address)
            .unwrap()
            .name(format!("org.mpris.MediaPlayer2.{name}"))
            .unwrap()
            .serve_at(
                PATH,
                Root {
                    identity: format!("Fake {name}"),
                },
            )
            .unwrap()
            .serve_at(PATH, player)
            .unwrap()
            .build()
            .await
            .unwrap();
        FakePlayer { conn, calls }
    }

    /// A playing player with Shuffle off and LoopStatus "None"; only calls() works on it.
    pub async fn start_looping(address: &str, name: &str, meta: Meta) -> FakePlayer {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let player = LoopingPlayer {
            meta,
            shuffle: false,
            loop_status: "None".into(),
            calls: calls.clone(),
        };
        let conn = zbus::connection::Builder::address(address)
            .unwrap()
            .name(format!("org.mpris.MediaPlayer2.{name}"))
            .unwrap()
            .serve_at(
                PATH,
                Root {
                    identity: format!("Fake {name}"),
                },
            )
            .unwrap()
            .serve_at(PATH, player)
            .unwrap()
            .build()
            .await
            .unwrap();
        FakePlayer { conn, calls }
    }

    async fn player(&self) -> zbus::object_server::InterfaceRef<Player> {
        self.conn
            .object_server()
            .interface::<_, Player>(PATH)
            .await
            .unwrap()
    }

    pub async fn set_status(&self, status: &str) {
        let iface = self.player().await;
        iface.get_mut().await.status = status.into();
        iface
            .get()
            .await
            .playback_status_changed(iface.signal_emitter())
            .await
            .unwrap();
    }

    pub async fn set_meta(&self, meta: Meta) {
        let iface = self.player().await;
        iface.get_mut().await.meta = meta;
        iface
            .get()
            .await
            .metadata_changed(iface.signal_emitter())
            .await
            .unwrap();
    }

    /// Sets CanPlay, CanPause and CanControl and announces them in one signal.
    pub async fn set_caps(&self, caps: Caps) {
        let iface = self.player().await;
        iface.get_mut().await.caps = caps;
        let player = iface.get().await;
        let emitter = iface.signal_emitter();
        player.can_play_changed(emitter).await.unwrap();
        player.can_pause_changed(emitter).await.unwrap();
        player.can_control_changed(emitter).await.unwrap();
    }

    /// Changes the position silently, as real players do during playback.
    pub async fn set_position(&self, position: i64) {
        self.player().await.get_mut().await.position = position;
    }

    pub async fn seek(&self, position: i64) {
        let iface = self.player().await;
        iface.get_mut().await.position = position;
        Player::seeked(iface.signal_emitter(), position)
            .await
            .unwrap();
    }

    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    pub async fn vanish(self) {
        self.conn.close().await.unwrap();
    }
}
