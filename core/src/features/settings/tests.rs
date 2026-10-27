use std::fs;
use std::time::Duration;

use super::*;

#[test]
fn defaults_match_spec() {
    let c = Config::default();
    let a = &c.appearance;
    assert_eq!(
        (
            a.height,
            a.idle_width,
            a.playing_width,
            a.expanded_width,
            a.expanded_height
        ),
        (32, 180, 260, 420, 150)
    );
    assert_eq!((a.corner_radius, a.ear_radius), (14, 8));
    assert_eq!(a.background, "#000000");
    assert_eq!(a.foreground, "#ffffff");
    assert!(a.use_album_accent);
    assert_eq!(a.animation_speed, 1.0);
    assert_eq!(a.osd_width, 300);
    assert_eq!(a.background_opacity, 1.0);
    assert_eq!(a.accent, "#ffffff");
    let b = &c.behavior;
    assert_eq!((b.open_delay_ms, b.close_delay_ms), (120, 300));
    assert!(b.move_clock);
    assert!(b.show_lyrics);
    assert!(b.replace_osd);
    assert_eq!(b.osd_duration_ms, 1500);
    assert!(b.show_caps_lock);
    assert!(b.all_monitors);
    assert!(b.device_alerts);
    assert_eq!(b.alert_duration_ms, 3000);
    assert!(b.show_clock);
    assert_eq!(b.clock_format, "system");
    assert!(c.lyrics.enabled);
}

#[test]
fn default_file_parses_to_defaults() {
    assert_eq!(parse(DEFAULT_CONFIG_TOML).unwrap(), Config::default());
}

#[test]
fn partial_file_overrides_only_given_keys() {
    let c = parse("[appearance]\nheight = 40\n").unwrap();
    assert_eq!(c.appearance.height, 40);
    let mut expected = Config::default();
    expected.appearance.height = 40;
    assert_eq!(c, expected);
}

#[test]
fn invalid_color_is_rejected() {
    let err = parse("[appearance]\nbackground = \"black\"\n").unwrap_err();
    assert!(err.message.contains("background"), "{err}");
}

#[test]
fn out_of_range_height_is_rejected() {
    let err = parse("[appearance]\nheight = 8\n").unwrap_err();
    assert!(err.message.contains("height"), "{err}");
}

#[test]
fn out_of_range_osd_values_are_rejected() {
    let err = parse("[appearance]\nosd_width = 10\n").unwrap_err();
    assert!(err.message.contains("osd_width"), "{err}");
    let err = parse("[behavior]\nosd_duration_ms = 50\n").unwrap_err();
    assert!(err.message.contains("osd_duration_ms"), "{err}");
    let err = parse("[behavior]\nalert_duration_ms = 100\n").unwrap_err();
    assert!(err.message.contains("alert_duration_ms"), "{err}");
}

#[test]
fn new_appearance_and_clock_values_are_checked() {
    let err = parse("[appearance]\nbackground_opacity = 1.5\n").unwrap_err();
    assert!(err.message.contains("background_opacity"), "{err}");
    let err = parse("[appearance]\naccent = \"red\"\n").unwrap_err();
    assert!(err.message.contains("accent"), "{err}");
    let err = parse("[behavior]\nclock_format = \"24\"\n").unwrap_err();
    assert!(err.message.contains("clock_format"), "{err}");
    let c = parse("[appearance]\nbackground_opacity = 0.0\n[behavior]\nclock_format = \"24h\"\n")
        .unwrap();
    assert_eq!(c.appearance.background_opacity, 0.0);
    assert_eq!(c.behavior.clock_format, "24h");
}

#[test]
fn lyrics_to_dbus_has_all_keys() {
    let map = Config::default().lyrics.to_dbus();
    let keys: Vec<_> = map.keys().cloned().collect();
    assert_eq!(keys, ["enabled"]);
    assert!(bool::try_from(&map["enabled"]).unwrap());
}

#[test]
fn syntax_error_reports_line_and_column() {
    let err = parse("[appearance\n").unwrap_err();
    assert_eq!(err.line, Some(1));
    assert!(err.column.is_some());
}

#[test]
fn wrong_type_is_rejected() {
    assert!(parse("[behavior]\nmove_clock = \"yes\"\n").is_err());
}

#[test]
fn load_or_init_writes_default_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nokta").join("config.toml");
    let store = Store::load_or_init(&path);
    assert_eq!(fs::read_to_string(&path).unwrap(), DEFAULT_CONFIG_TOML);
    assert_eq!(store.current(), &Config::default());
}

#[test]
fn load_or_init_with_invalid_file_uses_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    fs::write(&path, "[appearance\n").unwrap();
    let store = Store::load_or_init(&path);
    assert_eq!(store.current(), &Config::default());
    assert_eq!(fs::read_to_string(&path).unwrap(), "[appearance\n");
}

#[test]
fn reload_reports_change() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    let mut store = Store::load_or_init(&path);
    assert!(!store.reload().unwrap());
    fs::write(&path, "[appearance]\nheight = 40\n").unwrap();
    assert!(store.reload().unwrap());
    assert_eq!(store.current().appearance.height, 40);
}

#[test]
fn invalid_reload_keeps_last_valid() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    fs::write(&path, "[appearance]\nheight = 40\n").unwrap();
    let mut store = Store::load_or_init(&path);
    fs::write(&path, "[appearance]\nheight = \"tall\"\n").unwrap();
    assert!(store.reload().is_err());
    assert_eq!(store.current().appearance.height, 40);
}

#[test]
fn deleted_file_keeps_last_valid() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    fs::write(&path, "[appearance]\nheight = 40\n").unwrap();
    let mut store = Store::load_or_init(&path);
    fs::remove_file(&path).unwrap();
    assert!(!store.reload().unwrap());
    assert_eq!(store.current().appearance.height, 40);
}

#[test]
fn appearance_to_dbus_has_all_keys() {
    let map = Config::default().appearance.to_dbus();
    let mut keys: Vec<_> = map.keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "accent",
            "animation_speed",
            "background",
            "background_opacity",
            "corner_radius",
            "ear_radius",
            "expanded_height",
            "expanded_width",
            "foreground",
            "height",
            "idle_width",
            "osd_width",
            "playing_width",
            "use_album_accent",
        ]
    );
    assert_eq!(u32::try_from(&map["height"]).unwrap(), 32);
    assert_eq!(f64::try_from(&map["animation_speed"]).unwrap(), 1.0);
}

#[test]
fn behavior_to_dbus_has_all_keys() {
    let map = Config::default().behavior.to_dbus();
    let mut keys: Vec<_> = map.keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "alert_duration_ms",
            "all_monitors",
            "clock_format",
            "close_delay_ms",
            "device_alerts",
            "move_clock",
            "open_delay_ms",
            "osd_duration_ms",
            "replace_osd",
            "show_caps_lock",
            "show_clock",
            "show_lyrics"
        ]
    );
    assert!(bool::try_from(&map["move_clock"]).unwrap());
}

#[tokio::test]
async fn watch_reports_rename_into_place() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    fs::write(&path, "").unwrap();
    let (_watcher, mut rx) = watch(path.clone()).unwrap();
    let tmp = dir.path().join("config.toml.tmp");
    fs::write(&tmp, "[appearance]\nheight = 40\n").unwrap();
    fs::rename(&tmp, &path).unwrap();
    let got = tokio::time::timeout(Duration::from_secs(1), rx.recv()).await;
    assert!(matches!(got, Ok(Some(()))));
}

#[tokio::test]
async fn watch_ignores_other_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    let (_watcher, mut rx) = watch(path.clone()).unwrap();
    fs::write(dir.path().join("other.txt"), "x").unwrap();
    let got = tokio::time::timeout(Duration::from_millis(400), rx.recv()).await;
    assert!(got.is_err(), "unexpected event {got:?}");
}
