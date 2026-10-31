//! Who uses the camera and the microphone, from what Windows' privacy
//! settings record for each app: an app uses a device while its entry has
//! started and not yet stopped. Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

/// 1970-01-01 in FILETIME's 100 ns steps since 1601.
const UNIX_EPOCH_FILETIME: u64 = 116_444_736_000_000_000;

/// An app's entry under a device in Windows' consent store.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    /// The entry's key: a package's family name, or for a desktop app its
    /// path with `#` for `\`.
    pub key: String,
    pub packaged: bool,
    /// `LastUsedTimeStart`, a FILETIME; 0 if never.
    pub started: u64,
    /// `LastUsedTimeStop`, a FILETIME; 0 while in use.
    pub stopped: u64,
}

/// A device in use: by which app, and since when on the wall clock in µs.
#[derive(Debug, Clone, PartialEq)]
pub struct InUse {
    pub app: String,
    pub since_us: i64,
}

/// The camera and the microphone, and whether the microphone is muted.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PrivacyState {
    pub camera: Option<InUse>,
    pub microphone: Option<InUse>,
    pub muted: bool,
}

/// The device in use, by the app that started first, as `entries` say.
/// `own_exe` (Nokta's file name) is skipped: its loopback records what
/// plays, not the microphone.
pub fn in_use(entries: &[Entry], own_exe: &str) -> Option<InUse> {
    let own = format!("#{}", own_exe.to_lowercase());
    entries
        .iter()
        .filter(|e| e.started != 0 && e.stopped == 0)
        .filter(|e| e.packaged || !e.key.to_lowercase().ends_with(&own))
        .min_by_key(|e| e.started)
        .map(|e| InUse {
            app: app_name(&e.key, e.packaged),
            since_us: unix_us(e.started),
        })
}

/// A short name from an entry's key: `Zoom` from
/// `C:#Program Files#Zoom#bin#Zoom.exe`, `WindowsCamera` from
/// `Microsoft.WindowsCamera_8wekyb3d8bbwe`.
pub fn app_name(key: &str, packaged: bool) -> String {
    if packaged {
        let family = key.split('_').next().unwrap_or(key);
        family.rsplit('.').next().unwrap_or(family).to_owned()
    } else {
        let file = key.rsplit(['#', '\\']).next().unwrap_or(key);
        match file.len().checked_sub(4) {
            Some(stem) if file[stem..].eq_ignore_ascii_case(".exe") => file[..stem].to_owned(),
            _ => file.to_owned(),
        }
    }
}

/// A FILETIME on the wall clock in µs since 1970.
pub fn unix_us(filetime: u64) -> i64 {
    i64::try_from(filetime.saturating_sub(UNIX_EPOCH_FILETIME) / 10).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-31 10:00:00 UTC as a FILETIME.
    const TEN_AM: u64 = UNIX_EPOCH_FILETIME + 1_793_440_800 * 10_000_000;

    fn entry(key: &str, packaged: bool, started: u64, stopped: u64) -> Entry {
        Entry {
            key: key.into(),
            packaged,
            started,
            stopped,
        }
    }

    #[test]
    fn names_desktop_apps_and_packages() {
        assert_eq!(
            app_name("C:#Program Files#Zoom#bin#Zoom.exe", false),
            "Zoom"
        );
        assert_eq!(app_name("C:#Tools#recorder.EXE", false), "recorder");
        assert_eq!(app_name("C:#Tools#obs", false), "obs");
        assert_eq!(
            app_name("Microsoft.WindowsCamera_8wekyb3d8bbwe", true),
            "WindowsCamera"
        );
        assert_eq!(app_name("MSTeams_8wekyb3d8bbwe", true), "MSTeams");
    }

    #[test]
    fn turns_a_filetime_into_wall_clock_microseconds() {
        assert_eq!(unix_us(TEN_AM), 1_793_440_800_000_000);
        assert_eq!(unix_us(UNIX_EPOCH_FILETIME + 15), 1);
        assert_eq!(unix_us(0), 0);
    }

    #[test]
    fn a_device_is_in_use_while_an_entry_has_not_stopped() {
        let entries = [
            entry("C:#Apps#Old.exe", false, TEN_AM - 10, TEN_AM - 5),
            entry("Never_abc", true, 0, 0),
        ];
        assert_eq!(in_use(&entries, "Nokta.exe"), None);
        let entries = [
            entry("C:#Apps#Old.exe", false, TEN_AM - 10, TEN_AM - 5),
            entry("C:#Program Files#Zoom#bin#Zoom.exe", false, TEN_AM, 0),
        ];
        assert_eq!(
            in_use(&entries, "Nokta.exe"),
            Some(InUse {
                app: "Zoom".into(),
                since_us: unix_us(TEN_AM),
            })
        );
    }

    #[test]
    fn the_app_that_started_first_names_it() {
        let entries = [
            entry("C:#Apps#Later.exe", false, TEN_AM + 600_000_000, 0),
            entry("MSTeams_8wekyb3d8bbwe", true, TEN_AM, 0),
        ];
        assert_eq!(in_use(&entries, "Nokta.exe").unwrap().app, "MSTeams");
    }

    #[test]
    fn nokta_itself_is_skipped() {
        let entries = [entry(
            "C:#Users#ren#AppData#Local#Nokta#nokta.exe",
            false,
            TEN_AM,
            0,
        )];
        assert_eq!(in_use(&entries, "Nokta.exe"), None);
    }
}
