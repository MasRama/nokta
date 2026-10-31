//! The timer's sounds, from Windows' own sound scheme, as the extension
//! plays the sound theme's on GNOME.

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC, SND_FLAGS, SND_NODEFAULT};

/// A focus session or a break finished.
pub const DONE: &str = "Notification.Default";
/// A countdown ran out.
pub const COUNTDOWN: &str = "Notification.Reminder";
/// An alarm went off; played once.
pub const ALARM: &str = "Notification.Looping.Alarm";

/// Plays the scheme's sound `alias` without waiting; nothing when the user
/// set none.
pub fn play(alias: &str) {
    let alias = HSTRING::from(alias);
    let flags = SND_FLAGS(SND_ALIAS.0 | SND_ASYNC.0 | SND_NODEFAULT.0);
    // SAFETY: `alias` is a NUL-ended string that outlives the call; with
    // SND_ASYNC Windows copies what it needs.
    if !unsafe { PlaySoundW(PCWSTR(alias.as_ptr()), None, flags) }.as_bool() {
        tracing::debug!("Windows has no sound {alias}");
    }
}
