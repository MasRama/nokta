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
fn timer_defaults_and_limits() {
    let t = Config::default().timer;
    assert_eq!((t.focus_minutes, t.break_minutes, t.sound), (25, 5, true));
    for bad in [
        "focus_minutes = 0",
        "focus_minutes = 181",
        "break_minutes = 61",
    ] {
        let err = parse(&format!("[timer]\n{bad}\n")).unwrap_err();
        let key = bad.split(' ').next().unwrap();
        assert!(err.message.contains(&format!("timer.{key}")), "{err}");
    }
    let c = parse("[timer]\nfocus_minutes = 50\nbreak_minutes = 0\nsound = false\n").unwrap();
    assert_eq!(
        (c.timer.focus_minutes, c.timer.break_minutes, c.timer.sound),
        (50, 0, false)
    );
}

#[test]
fn timer_to_dbus_has_all_keys() {
    let map = Config::default().timer.to_dbus();
    let mut keys: Vec<_> = map.keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["break_minutes", "focus_minutes", "sound"]);
    assert_eq!(u32::try_from(&map["focus_minutes"]).unwrap(), 25);
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

mod edit {
    use zbus::zvariant::Value;

    use super::super::edit::set_key;
    use super::*;

    #[test]
    fn replaces_a_value_and_keeps_its_comment() {
        let text = set_key(DEFAULT_CONFIG_TOML, "appearance", "height", &Value::U32(40)).unwrap();
        let line = text.lines().find(|l| l.starts_with("height")).unwrap();
        assert!(line.starts_with("height = 40 "), "{line}");
        assert!(line.contains("# collapsed notch height"), "{line}");
        assert!(text.starts_with("# Nokta configuration."));
        let mut expected = Config::default();
        expected.appearance.height = 40;
        assert_eq!(parse(&text).unwrap(), expected);
    }

    #[test]
    fn adds_a_missing_key_and_table() {
        let text = set_key(
            "[appearance]\nheight = 40\n",
            "behavior",
            "clock_format",
            &Value::from("24h"),
        )
        .unwrap();
        let c = parse(&text).unwrap();
        assert_eq!(c.behavior.clock_format, "24h");
        assert_eq!(c.appearance.height, 40);

        let text = set_key("", "timer", "focus_minutes", &Value::U32(50)).unwrap();
        assert_eq!(parse(&text).unwrap().timer.focus_minutes, 50);

        let text = set_key("", "lyrics", "enabled", &Value::Bool(false)).unwrap();
        assert!(!parse(&text).unwrap().lyrics.enabled);
        let text = set_key(&text, "lyrics", "enabled", &Value::Bool(true)).unwrap();
        assert_eq!(text.matches("enabled").count(), 1, "{text}");
    }

    #[test]
    fn unknown_tables_and_keys_are_rejected() {
        let err = set_key("", "colors", "height", &Value::U32(40)).unwrap_err();
        assert!(err.message.contains("colors"), "{err}");
        let err = set_key("", "appearance", "width", &Value::U32(40)).unwrap_err();
        assert!(err.message.contains("appearance.width"), "{err}");
    }

    #[test]
    fn wrong_types_are_rejected() {
        let err = set_key("", "appearance", "height", &Value::from("tall")).unwrap_err();
        assert!(err.message.contains("appearance.height"), "{err}");
        let err = set_key("", "behavior", "move_clock", &Value::U32(1)).unwrap_err();
        assert!(err.message.contains("behavior.move_clock"), "{err}");
        let err = set_key("", "appearance", "height", &Value::F64(40.5)).unwrap_err();
        assert!(err.message.contains("whole number"), "{err}");
    }

    #[test]
    fn numbers_are_coerced() {
        for value in [
            Value::I32(40),
            Value::I64(40),
            Value::F64(40.0),
            Value::U16(40),
        ] {
            let text = set_key("", "appearance", "height", &value).unwrap();
            assert_eq!(parse(&text).unwrap().appearance.height, 40, "{value:?}");
        }
        let text = set_key("", "appearance", "animation_speed", &Value::U32(2)).unwrap();
        assert_eq!(parse(&text).unwrap().appearance.animation_speed, 2.0);
        let text = set_key("", "appearance", "background_opacity", &Value::F64(0.5)).unwrap();
        assert_eq!(parse(&text).unwrap().appearance.background_opacity, 0.5);
    }

    #[test]
    fn invalid_values_are_rejected() {
        let err = set_key("", "appearance", "height", &Value::U32(5)).unwrap_err();
        assert!(err.message.contains("appearance.height"), "{err}");
        let err = set_key("", "appearance", "background", &Value::from("black")).unwrap_err();
        assert!(err.message.contains("appearance.background"), "{err}");
        let err = set_key("", "appearance", "height", &Value::I32(-3)).unwrap_err();
        assert!(err.message.contains("height"), "{err}");
    }

    #[test]
    fn a_broken_file_is_not_touched() {
        let err = set_key("[appearance\n", "appearance", "height", &Value::U32(40)).unwrap_err();
        let message = err.to_string();
        assert!(
            message.starts_with("config.toml has an error at line 1"),
            "{message}"
        );
        assert!(message.ends_with("fix it first"), "{message}");
    }

    #[test]
    fn a_value_line_is_replaced_not_duplicated() {
        let text = "[appearance]\nheight = 40 # mine\n";
        let text = set_key(text, "appearance", "height", &Value::U32(44)).unwrap();
        assert_eq!(text, "[appearance]\nheight = 44 # mine\n");
    }
}
