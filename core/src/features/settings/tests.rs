use std::fs;
use std::time::Duration;

use std::collections::HashMap;

use super::*;

fn entries(list: Vec<(&'static str, SettingValue)>) -> HashMap<&'static str, SettingValue> {
    list.into_iter().collect()
}

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
    assert_eq!(a.theme, "midnight");
    assert!(a.progress_line);
    assert!(a.alert_glow);
    assert!(!a.cover_backdrop);
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
    assert!(b.gestures);
    assert!(c.lyrics.enabled);
    assert!(c.lyrics.romanize);
    assert!(
        !parse("[lyrics]\nromanize = false\n")
            .unwrap()
            .lyrics
            .romanize
    );
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
    assert_eq!(
        (t.long_break_minutes, t.sessions_before_long_break),
        (15, 4)
    );
    assert!(t.quiet_notifications);
    assert_eq!(t.shortcut, "<Super><Alt>f");
    for bad in [
        "focus_minutes = 0",
        "focus_minutes = 181",
        "break_minutes = 61",
        "long_break_minutes = 0",
        "long_break_minutes = 61",
        "sessions_before_long_break = 13",
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
fn timer_entries_have_all_keys() {
    let map = entries(Config::default().timer.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "break_minutes",
            "focus_minutes",
            "long_break_minutes",
            "quiet_notifications",
            "sessions_before_long_break",
            "shortcut",
            "sound"
        ]
    );
    assert_eq!(map["focus_minutes"], SettingValue::Uint(25));
}

#[test]
fn notifications_defaults_and_limits() {
    let n = Config::default().notifications;
    assert_eq!((n.in_notch, n.duration_ms, n.show_body), (true, 5000, true));
    for bad in ["duration_ms = 999", "duration_ms = 30001"] {
        let err = parse(&format!("[notifications]\n{bad}\n")).unwrap_err();
        assert!(err.message.contains("notifications.duration_ms"), "{err}");
    }
    let c = parse("[notifications]\nin_notch = false\nshow_body = false\n").unwrap();
    assert_eq!(
        (c.notifications.in_notch, c.notifications.show_body),
        (false, false)
    );
    let map = entries(Config::default().notifications.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort();
    assert_eq!(keys, ["duration_ms", "in_notch", "show_body"]);
    assert_eq!(map["duration_ms"], SettingValue::Uint(5000));
}

#[test]
fn activities_defaults_and_limits() {
    assert_eq!(Config::default().activities.stale_minutes, 30);
    assert!(Config::default().activities.auto_progress);
    assert!(Config::default().behavior.live_activities);
    assert!(Config::default().behavior.file_shelf);
    assert!(Config::default().behavior.screenshot_preview);
    for bad in ["stale_minutes = 0", "stale_minutes = 1441"] {
        let err = parse(&format!("[activities]\n{bad}\n")).unwrap_err();
        assert!(err.message.contains("activities.stale_minutes"), "{err}");
    }
    let c = parse("[activities]\nstale_minutes = 1440\n").unwrap();
    assert_eq!(c.activities.stale_minutes, 1440);
    assert!(
        !parse("[activities]\nauto_progress = false\n")
            .unwrap()
            .activities
            .auto_progress
    );
    let map = entries(Config::default().activities.entries());
    assert_eq!(map.len(), 2);
    assert_eq!(map["stale_minutes"], SettingValue::Uint(30));
    assert_eq!(map["auto_progress"], SettingValue::Bool(true));
}

#[test]
fn weather_defaults_and_units() {
    let w = Config::default().weather;
    assert!(w.enabled);
    assert_eq!(w.location, "");
    assert_eq!(w.units, "celsius");
    let c = parse("[weather]\nlocation = \"Jakarta\"\nunits = \"fahrenheit\"\n").unwrap();
    assert_eq!(c.weather.location, "Jakarta");
    assert_eq!(c.weather.units, "fahrenheit");
    let err = parse("[weather]\nunits = \"kelvin\"\n").unwrap_err();
    assert!(err.message.contains("weather.units"), "{err}");
    let map = entries(Config::default().weather.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort();
    assert_eq!(keys, ["enabled", "location", "units"]);
}

#[test]
fn clipboard_defaults_and_size_range() {
    let c = Config::default().clipboard;
    assert!(c.enabled);
    assert_eq!(c.max_items, 25);
    let c = parse("[clipboard]\nenabled = false\nmax_items = 5\n").unwrap();
    assert!(!c.clipboard.enabled);
    assert_eq!(c.clipboard.max_items, 5);
    assert_eq!(
        parse("[clipboard]\nmax_items = 100\n")
            .unwrap()
            .clipboard
            .max_items,
        100
    );
    for bad in [4, 101] {
        let err = parse(&format!("[clipboard]\nmax_items = {bad}\n")).unwrap_err();
        assert!(err.message.contains("clipboard.max_items"), "{err}");
    }
    let map = entries(Config::default().clipboard.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort();
    assert_eq!(keys, ["enabled", "max_items"]);
    assert_eq!(map["max_items"], SettingValue::Uint(25));
}

#[test]
fn media_defaults_to_the_pattern_bars() {
    assert!(!Config::default().media.real_equalizer);
    assert!(
        parse("[media]\nreal_equalizer = true\n")
            .unwrap()
            .media
            .real_equalizer
    );
    let map = entries(Config::default().media.entries());
    assert_eq!(map.keys().copied().collect::<Vec<_>>(), ["real_equalizer"]);
    assert_eq!(map["real_equalizer"], SettingValue::Bool(false));
}

#[test]
fn calendar_defaults_and_reminder_range() {
    let c = Config::default().calendar;
    assert!(c.enabled);
    assert_eq!(c.reminder_minutes, 5);
    let c = parse("[calendar]\nenabled = false\nreminder_minutes = 0\n").unwrap();
    assert!(!c.calendar.enabled);
    assert_eq!(c.calendar.reminder_minutes, 0);
    assert_eq!(
        parse("[calendar]\nreminder_minutes = 60\n")
            .unwrap()
            .calendar
            .reminder_minutes,
        60
    );
    let err = parse("[calendar]\nreminder_minutes = 61\n").unwrap_err();
    assert!(err.message.contains("calendar.reminder_minutes"), "{err}");
    assert_eq!(Config::default().calendar.agenda_size, 3);
    assert!(Config::default().calendar.countdown);
    for bad in [0, 6] {
        let err = parse(&format!("[calendar]\nagenda_size = {bad}\n")).unwrap_err();
        assert!(err.message.contains("calendar.agenda_size"), "{err}");
    }
    assert_eq!(
        parse("[calendar]\nagenda_size = 5\ncountdown = false\n")
            .unwrap()
            .calendar,
        CalendarConfig {
            agenda_size: 5,
            countdown: false,
            ..CalendarConfig::default()
        }
    );
    let map = entries(Config::default().calendar.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort();
    assert_eq!(
        keys,
        ["agenda_size", "countdown", "enabled", "reminder_minutes"]
    );
    assert_eq!(map["reminder_minutes"], SettingValue::Uint(5));
}

#[test]
fn home_defaults_names_and_limits() {
    let h = Config::default().home;
    assert_eq!(h.toggles, ["do_not_disturb", "caffeine", "dark_style"]);
    assert_eq!(
        h.tiles,
        ["notifications", "focus", "timer", "clipboard", "settings"]
    );
    let c = parse(
        "[home]\ntoggles = [\"night_light\", \"dark_style\"]\ntiles = [\"screenshot\", \"settings\"]\n",
    )
    .unwrap();
    assert_eq!(c.home.toggles, ["night_light", "dark_style"]);
    assert_eq!(c.home.tiles, ["screenshot", "settings"]);
    let c = parse("[home]\ntoggles = []\ntiles = []\n").unwrap();
    assert!(c.home.toggles.is_empty() && c.home.tiles.is_empty());
    for (bad, key) in [
        ("toggles = [\"wifi\"]", "home.toggles"),
        ("toggles = [\"caffeine\", \"caffeine\"]", "home.toggles"),
        (
            "toggles = [\"do_not_disturb\", \"caffeine\", \"dark_style\", \"night_light\"]",
            "home.toggles",
        ),
        ("tiles = [\"calendar\"]", "home.tiles"),
        (
            "tiles = [\"notifications\", \"focus\", \"timer\", \"clipboard\", \"settings\", \"screenshot\"]",
            "home.tiles",
        ),
    ] {
        let err = parse(&format!("[home]\n{bad}\n")).unwrap_err();
        assert!(err.message.contains(key), "{bad}: {err}");
    }
    let map = entries(Config::default().home.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort();
    assert_eq!(keys, ["tiles", "toggles"]);
    assert_eq!(
        map["toggles"],
        SettingValue::List(vec![
            "do_not_disturb".into(),
            "caffeine".into(),
            "dark_style".into()
        ])
    );
}

#[test]
fn lyrics_entries_have_all_keys() {
    let map = entries(Config::default().lyrics.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort_unstable();
    assert_eq!(keys, ["enabled", "romanize"]);
    assert_eq!(map["enabled"], SettingValue::Bool(true));
    assert_eq!(map["romanize"], SettingValue::Bool(true));
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
fn appearance_entries_have_all_keys() {
    let map = entries(Config::default().appearance.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "accent",
            "alert_glow",
            "animation_speed",
            "background",
            "background_end",
            "background_opacity",
            "corner_radius",
            "cover_backdrop",
            "ear_radius",
            "expanded_height",
            "expanded_width",
            "follow_system_style",
            "foreground",
            "gradient",
            "height",
            "idle_width",
            "light_theme",
            "osd_width",
            "picture",
            "picture_blur",
            "picture_darken",
            "playing_width",
            "progress_line",
            "theme",
            "use_album_accent",
        ]
    );
    assert_eq!(map["height"], SettingValue::Uint(32));
    assert_eq!(map["animation_speed"], SettingValue::Float(1.0));
    assert_eq!(map["background"], SettingValue::Text("#000000".into()));
}

#[test]
fn behavior_entries_have_all_keys() {
    let map = entries(Config::default().behavior.entries());
    let mut keys: Vec<_> = map.keys().copied().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "alert_duration_ms",
            "all_monitors",
            "call_indicator",
            "clock_format",
            "close_delay_ms",
            "device_alerts",
            "file_shelf",
            "fullscreen_alerts",
            "gestures",
            "live_activities",
            "move_clock",
            "open_delay_ms",
            "open_on",
            "open_shortcut",
            "osd_duration_ms",
            "privacy_dots",
            "replace_osd",
            "screenshot_preview",
            "show_caps_lock",
            "show_clock",
            "show_input_source",
            "show_lyrics",
            "show_num_lock"
        ]
    );
    assert_eq!(map["move_clock"], SettingValue::Bool(true));
    assert_eq!(map["call_indicator"], SettingValue::Bool(true));
    assert_eq!(
        map["fullscreen_alerts"],
        SettingValue::Text("important".into())
    );
    assert_eq!(map["open_on"], SettingValue::Text("hover".into()));
    assert_eq!(
        map["open_shortcut"],
        SettingValue::Text("<Super><Alt>n".into())
    );
}

#[test]
fn open_on_defaults_to_hover_and_takes_click() {
    assert_eq!(Config::default().behavior.open_on, "hover");
    let c = parse("[behavior]\nopen_on = \"click\"\n").unwrap();
    assert_eq!(c.behavior.open_on, "click");
    let err = parse("[behavior]\nopen_on = \"press\"\n").unwrap_err();
    assert!(err.message.contains("behavior.open_on"), "{err}");
    assert!(parse("[behavior]\nopen_on = true\n").is_err());
}

#[test]
fn open_shortcut_is_an_accelerator_or_empty() {
    assert_eq!(Config::default().behavior.open_shortcut, "<Super><Alt>n");
    for good in ["", "<Super><Alt>n", "<Control><Alt>space"] {
        let c = parse(&format!("[behavior]\nopen_shortcut = {good:?}\n")).unwrap();
        assert_eq!(c.behavior.open_shortcut, good);
    }
    for bad in ["<Super>", "Super+N", "n<Alt>"] {
        let err = parse(&format!("[behavior]\nopen_shortcut = {bad:?}\n")).unwrap_err();
        assert!(err.message.contains("behavior.open_shortcut"), "{err}");
    }
}

#[test]
fn fullscreen_alerts_default_to_important_and_take_three_values() {
    assert_eq!(Config::default().behavior.fullscreen_alerts, "important");
    for value in ["none", "important", "all"] {
        let c = parse(&format!("[behavior]\nfullscreen_alerts = \"{value}\"\n")).unwrap();
        assert_eq!(c.behavior.fullscreen_alerts, value);
    }
    let err = parse("[behavior]\nfullscreen_alerts = \"urgent\"\n").unwrap_err();
    assert!(err.message.contains("fullscreen_alerts"), "{err}");
    assert!(parse("[behavior]\nfullscreen_alerts = true\n").is_err());
}

#[test]
fn layout_popups_default_on_and_num_lock_off() {
    let b = Config::default().behavior;
    assert!(b.show_input_source);
    assert!(!b.show_num_lock);
    let c = parse("[behavior]\nshow_input_source = false\nshow_num_lock = true\n").unwrap();
    assert!(!c.behavior.show_input_source);
    assert!(c.behavior.show_num_lock);
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
    use super::super::edit::set_key;
    use super::*;
    use SettingValue as Value;

    #[test]
    fn replaces_a_value_and_keeps_its_comment() {
        let text = set_key(
            DEFAULT_CONFIG_TOML,
            "appearance",
            "height",
            &Value::Uint(40),
        )
        .unwrap();
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
            &Value::Text("24h".into()),
        )
        .unwrap();
        let c = parse(&text).unwrap();
        assert_eq!(c.behavior.clock_format, "24h");
        assert_eq!(c.appearance.height, 40);

        let text = set_key("", "timer", "focus_minutes", &Value::Uint(50)).unwrap();
        assert_eq!(parse(&text).unwrap().timer.focus_minutes, 50);

        let text = set_key("", "notifications", "in_notch", &Value::Bool(false)).unwrap();
        assert!(!parse(&text).unwrap().notifications.in_notch);
        let text = set_key("", "activities", "stale_minutes", &Value::Uint(5)).unwrap();
        assert_eq!(parse(&text).unwrap().activities.stale_minutes, 5);
        let text = set_key("", "weather", "location", &Value::Text("Bandung".into())).unwrap();
        assert_eq!(parse(&text).unwrap().weather.location, "Bandung");
        let text = set_key("", "calendar", "reminder_minutes", &Value::Uint(10)).unwrap();
        assert_eq!(parse(&text).unwrap().calendar.reminder_minutes, 10);
        let text = set_key("", "clipboard", "enabled", &Value::Bool(false)).unwrap();
        assert!(!parse(&text).unwrap().clipboard.enabled);
        let text = set_key("", "media", "real_equalizer", &Value::Bool(true)).unwrap();
        assert!(parse(&text).unwrap().media.real_equalizer);

        let tiles = Value::List(vec!["screenshot".into(), "focus".into()]);
        let text = set_key("", "home", "tiles", &tiles).unwrap();
        assert_eq!(parse(&text).unwrap().home.tiles, ["screenshot", "focus"]);
        assert!(
            text.contains("tiles = [\"screenshot\", \"focus\"]"),
            "{text}"
        );

        let text = set_key("", "lyrics", "enabled", &Value::Bool(false)).unwrap();
        assert!(!parse(&text).unwrap().lyrics.enabled);
        let text = set_key(&text, "lyrics", "enabled", &Value::Bool(true)).unwrap();
        assert_eq!(text.matches("enabled").count(), 1, "{text}");
    }

    #[test]
    fn unknown_tables_and_keys_are_rejected() {
        let err = set_key("", "colors", "height", &Value::Uint(40)).unwrap_err();
        assert!(err.message.contains("colors"), "{err}");
        let err = set_key("", "appearance", "width", &Value::Uint(40)).unwrap_err();
        assert!(err.message.contains("appearance.width"), "{err}");
    }

    #[test]
    fn wrong_types_are_rejected() {
        let err = set_key("", "appearance", "height", &Value::Text("tall".into())).unwrap_err();
        assert!(err.message.contains("appearance.height"), "{err}");
        let err = set_key("", "behavior", "move_clock", &Value::Uint(1)).unwrap_err();
        assert!(err.message.contains("behavior.move_clock"), "{err}");
        let err = set_key("", "appearance", "height", &Value::Float(40.5)).unwrap_err();
        assert!(err.message.contains("whole number"), "{err}");
        let err = set_key("", "home", "tiles", &Value::Text("focus".into())).unwrap_err();
        assert!(err.message.contains("a list of names"), "{err}");
        let err = set_key("", "appearance", "height", &Value::List(vec![])).unwrap_err();
        assert!(err.message.contains("appearance.height"), "{err}");
        let err = set_key("", "appearance", "animation_speed", &Value::Float(f64::NAN));
        assert!(err.unwrap_err().message.contains("a number"));
    }

    #[test]
    fn numbers_are_coerced() {
        for value in [Value::Uint(40), Value::Float(40.0)] {
            let text = set_key("", "appearance", "height", &value).unwrap();
            assert_eq!(parse(&text).unwrap().appearance.height, 40, "{value:?}");
        }
        let text = set_key("", "appearance", "animation_speed", &Value::Uint(2)).unwrap();
        assert_eq!(parse(&text).unwrap().appearance.animation_speed, 2.0);
        let text = set_key("", "appearance", "background_opacity", &Value::Float(0.5)).unwrap();
        assert_eq!(parse(&text).unwrap().appearance.background_opacity, 0.5);
    }

    #[test]
    fn invalid_values_are_rejected() {
        let err = set_key("", "appearance", "height", &Value::Uint(5)).unwrap_err();
        assert!(err.message.contains("appearance.height"), "{err}");
        let err =
            set_key("", "appearance", "background", &Value::Text("black".into())).unwrap_err();
        assert!(err.message.contains("appearance.background"), "{err}");
        let toggles = Value::List(vec!["airplane".into()]);
        let err = set_key("", "home", "toggles", &toggles).unwrap_err();
        assert!(err.message.contains("home.toggles"), "{err}");
        let alerts = Value::Text("urgent".into());
        let err = set_key("", "behavior", "fullscreen_alerts", &alerts).unwrap_err();
        assert!(err.message.contains("behavior.fullscreen_alerts"), "{err}");
        let open_on = Value::Text("press".into());
        let err = set_key("", "behavior", "open_on", &open_on).unwrap_err();
        assert!(err.message.contains("behavior.open_on"), "{err}");
        let err = set_key("", "appearance", "height", &Value::Float(-3.0)).unwrap_err();
        assert!(err.message.contains("height"), "{err}");
    }

    #[test]
    fn a_broken_file_is_not_touched() {
        let err = set_key("[appearance\n", "appearance", "height", &Value::Uint(40)).unwrap_err();
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
        let text = set_key(text, "appearance", "height", &Value::Uint(44)).unwrap();
        assert_eq!(text, "[appearance]\nheight = 44 # mine\n");
    }

    #[test]
    fn the_gradient_is_set_and_checked() {
        let text = set_key("", "appearance", "gradient", &Value::Text("across".into())).unwrap();
        let text = set_key(
            &text,
            "appearance",
            "background_end",
            &Value::Text("#ff0000".into()),
        )
        .unwrap();
        let a = parse(&text).unwrap().appearance;
        assert_eq!(
            (a.gradient.as_str(), a.background_end.as_str()),
            ("across", "#ff0000")
        );
        let err = set_key("", "appearance", "gradient", &Value::Text("up".into())).unwrap_err();
        assert!(err.message.contains("appearance.gradient"), "{err}");
    }
}

#[test]
fn shortcut_is_an_accelerator_or_empty() {
    for good in [
        "",
        "<Super><Alt>f",
        "<Control><Shift>F12",
        "<Primary>space",
        "Pause",
    ] {
        let c = parse(&format!("[timer]\nshortcut = {good:?}\n")).unwrap();
        assert_eq!(c.timer.shortcut, good);
    }
    for bad in ["<Super>", "<Super> f", "Super+F", "<Super><Alt", "f<Alt>"] {
        let err = parse(&format!("[timer]\nshortcut = {bad:?}\n")).unwrap_err();
        assert!(err.message.contains("timer.shortcut"), "{err}");
    }
}

#[test]
fn custom_gradient_defaults_and_values() {
    let a = Config::default().appearance;
    assert_eq!(
        (a.gradient.as_str(), a.background_end.as_str()),
        ("none", "#1c1c1e")
    );
    for gradient in GRADIENTS {
        let c = parse(&format!("[appearance]\ngradient = \"{gradient}\"\n")).unwrap();
        assert_eq!(c.appearance.gradient, gradient);
    }
    let err = parse("[appearance]\ngradient = \"up\"\n").unwrap_err();
    assert!(err.message.contains("appearance.gradient"), "{err}");
    assert!(err.message.contains("\"diagonal\""), "{err}");
    let err = parse("[appearance]\nbackground_end = \"blue\"\n").unwrap_err();
    assert!(err.message.contains("appearance.background_end"), "{err}");
}

#[test]
fn the_light_style_theme_is_a_known_one() {
    let a = Config::default().appearance;
    assert!(!a.follow_system_style);
    assert_eq!(a.light_theme, "paper");
    let c = parse("[appearance]\nfollow_system_style = true\nlight_theme = \"glass\"\n").unwrap();
    assert!(c.appearance.follow_system_style);
    assert_eq!(c.appearance.light_theme, "glass");
    let err = parse("[appearance]\nlight_theme = \"neon\"\n").unwrap_err();
    assert!(err.message.contains("appearance.light_theme"), "{err}");
}

#[test]
fn picture_theme_defaults_and_ranges() {
    assert!(THEMES.contains(&"picture"));
    let a = Config::default().appearance;
    assert_eq!(a.picture, "");
    assert_eq!(a.picture_darken, 0.35);
    assert_eq!(a.picture_blur, 0);
    let c = parse(
        "[appearance]\ntheme = \"picture\"\npicture = \"~/Pictures/sea.jpg\"\npicture_darken = 0.8\npicture_blur = 40\n",
    )
    .unwrap();
    assert_eq!(c.appearance.picture, "~/Pictures/sea.jpg");
    assert_eq!(c.appearance.picture_darken, 0.8);
    assert_eq!(c.appearance.picture_blur, 40);
    // A picture on a drive that is not mounted is still a valid setting.
    assert!(parse("[appearance]\npicture = \"/media/gone/x.png\"\n").is_ok());
    let err = parse("[appearance]\npicture_darken = 0.9\n").unwrap_err();
    assert!(err.message.contains("appearance.picture_darken"), "{err}");
    let err = parse("[appearance]\npicture_blur = 41\n").unwrap_err();
    assert!(err.message.contains("appearance.picture_blur"), "{err}");
}

#[test]
fn theme_must_be_a_known_one() {
    let err = parse("[appearance]\ntheme = \"neon\"\n").unwrap_err();
    assert!(err.message.contains("appearance.theme"), "{err}");
    for theme in THEMES {
        let c = parse(&format!("[appearance]\ntheme = \"{theme}\"\n")).unwrap();
        assert_eq!(c.appearance.theme, theme);
    }
}
