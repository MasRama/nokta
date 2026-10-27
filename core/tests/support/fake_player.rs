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
    pub length_us: i64,
}

impl Meta {
    pub fn new(n: u32) -> Meta {
        Meta {
            track_id: format!("/org/nokta/track/{n}"),
            title: format!("Song {n}"),
            artists: vec!["Artist".into()],
            length_us: 200_000_000,
        }
    }
}

struct Player {
    status: String,
    meta: Meta,
    position: i64,
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
    fn can_play_pause(&self) -> bool {
        true
    }
    #[zbus(property)]
    fn can_go_next(&self) -> bool {
        true
    }
    #[zbus(property)]
    fn can_go_previous(&self) -> bool {
        true
    }
    #[zbus(property)]
    fn can_seek(&self) -> bool {
        true
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
