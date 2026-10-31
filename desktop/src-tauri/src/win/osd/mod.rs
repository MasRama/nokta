//! What Windows' own OSD shows, for the notch's `Osd1.Show`: the keys, the
//! volume and the brightness, each followed on its own thread.

mod brightness;
mod keys;
mod volume;

use tokio::sync::mpsc;

use crate::osd::Osd;

/// Starts following them all; the receiver gets what to show.
pub fn spawn() -> mpsc::Receiver<Osd> {
    let (tx, rx) = mpsc::channel(32);
    thread("nokta-keys", {
        let tx = tx.clone();
        move || keys::run(tx)
    });
    thread("nokta-volume", {
        let tx = tx.clone();
        move || {
            if let Err(err) = volume::run(tx) {
                tracing::warn!("no volume OSD: {err}");
            }
        }
    });
    thread("nokta-brightness", move || {
        if let Err(err) = brightness::run(tx) {
            tracing::info!("no brightness OSD: {err}");
        }
    });
    rx
}

fn thread(name: &str, run: impl FnOnce() + Send + 'static) {
    if let Err(err) = std::thread::Builder::new().name(name.into()).spawn(run) {
        tracing::warn!("cannot start {name}: {err}");
    }
}
