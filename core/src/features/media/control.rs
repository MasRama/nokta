use tokio::sync::{mpsc, oneshot};
use zbus::zvariant::ObjectPath;

use super::watcher::{Active, Event};

/// Forwards transport controls to whichever player is active when the call
/// is made. Every call is a no-op when there is no active player.
#[derive(Clone)]
pub struct Controller {
    tx: mpsc::UnboundedSender<Event>,
}

impl Controller {
    pub(super) fn new(tx: mpsc::UnboundedSender<Event>) -> Controller {
        Controller { tx }
    }

    async fn active(&self) -> Option<Active> {
        let (reply, answer) = oneshot::channel();
        self.tx.send(Event::Active(reply)).ok()?;
        answer.await.ok().flatten()
    }

    pub async fn play_pause(&self) -> zbus::Result<()> {
        match self.active().await {
            Some(a) => a.proxy.play_pause().await,
            None => Ok(()),
        }
    }

    pub async fn next(&self) -> zbus::Result<()> {
        match self.active().await {
            Some(a) => a.proxy.next().await,
            None => Ok(()),
        }
    }

    pub async fn previous(&self) -> zbus::Result<()> {
        match self.active().await {
            Some(a) => a.proxy.previous().await,
            None => Ok(()),
        }
    }

    /// MPRIS `SetPosition` needs the current track id; without one, or when
    /// the player cannot seek, the call is ignored.
    pub async fn set_position(&self, position_us: i64) -> zbus::Result<()> {
        let Some(active) = self.active().await else {
            return Ok(());
        };
        let Some(track_id) = active.track_id.filter(|_| active.can_seek) else {
            return Ok(());
        };
        let Ok(track_id) = ObjectPath::try_from(track_id.as_str()) else {
            return Ok(());
        };
        let upper = if active.length_us > 0 {
            active.length_us
        } else {
            i64::MAX
        };
        active
            .proxy
            .set_position(&track_id, position_us.clamp(0, upper))
            .await
    }

    /// Asks the watcher to re-read the active player's position; the new
    /// snapshot arrives on the state channel.
    pub async fn refresh_position(&self) -> zbus::Result<()> {
        let _ = self.tx.send(Event::Refresh);
        Ok(())
    }
}
