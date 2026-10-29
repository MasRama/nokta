//! The config model, its defaults and validation.

use std::fmt;

use serde::Deserialize;

/// The commented default file written on first run. It parses to [`Config::default`].
pub const DEFAULT_CONFIG_TOML: &str = include_str!("default_config.toml");

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct Config {
    pub appearance: Appearance,
    pub behavior: Behavior,
    pub media: MediaConfig,
    pub lyrics: LyricsConfig,
    pub timer: TimerConfig,
    pub notifications: NotificationsConfig,
    pub activities: ActivitiesConfig,
    pub weather: WeatherConfig,
    pub calendar: CalendarConfig,
    pub clipboard: ClipboardConfig,
    pub home: HomeConfig,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(default)]
pub struct Appearance {
    pub height: u32,
    pub idle_width: u32,
    pub playing_width: u32,
    pub expanded_width: u32,
    pub expanded_height: u32,
    pub corner_radius: u32,
    pub ear_radius: u32,
    pub background: String,
    pub foreground: String,
    pub use_album_accent: bool,
    pub animation_speed: f64,
    pub osd_width: u32,
    pub background_opacity: f64,
    pub accent: String,
    /// One of THEMES; only "custom" uses the colors above.
    pub theme: String,
    /// A line along the closed notch's bottom edge for the timer, countdown,
    /// activity or song.
    pub progress_line: bool,
    /// A glow under the notch in the colour of an alert.
    pub alert_glow: bool,
    /// A soft shadow under the notch and a thin rim along its bottom edge.
    pub depth: bool,
    /// One of GRADIENTS: the custom theme's fill from `background` to
    /// `background_end`, or flat.
    pub gradient: String,
    pub background_end: String,
    /// `theme` under a dark system style, `light_theme` under a light one.
    pub follow_system_style: bool,
    pub light_theme: String,
    /// The image the picture theme shows; `~/` is the home folder, empty is none.
    pub picture: String,
    /// How much the picture is darkened under the notch's text, 0 to 0.8.
    pub picture_darken: f64,
    /// Blur of the picture in px, 0 to 40.
    pub picture_blur: u32,
    /// Shows the song's blurred cover behind the open player.
    pub cover_backdrop: bool,
}

impl Default for Appearance {
    fn default() -> Self {
        Appearance {
            height: 32,
            idle_width: 180,
            playing_width: 260,
            expanded_width: 420,
            expanded_height: 150,
            corner_radius: 14,
            ear_radius: 8,
            background: "#000000".into(),
            foreground: "#ffffff".into(),
            use_album_accent: true,
            animation_speed: 1.0,
            osd_width: 300,
            background_opacity: 1.0,
            accent: "#ffffff".into(),
            theme: "midnight".into(),
            progress_line: true,
            alert_glow: true,
            depth: true,
            gradient: "none".into(),
            background_end: "#1c1c1e".into(),
            follow_system_style: false,
            light_theme: "paper".into(),
            picture: String::new(),
            picture_darken: 0.35,
            picture_blur: 0,
            cover_backdrop: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(default)]
pub struct Behavior {
    pub open_delay_ms: u32,
    pub close_delay_ms: u32,
    pub move_clock: bool,
    pub show_lyrics: bool,
    pub replace_osd: bool,
    pub osd_duration_ms: u32,
    pub show_caps_lock: bool,
    /// The new keyboard layout when it changes.
    pub show_input_source: bool,
    pub show_num_lock: bool,
    pub all_monitors: bool,
    pub device_alerts: bool,
    pub alert_duration_ms: u32,
    pub show_clock: bool,
    pub clock_format: String,
    /// Dots for the camera, microphone and screen sharing.
    pub privacy_dots: bool,
    /// The app on a call and how long the microphone has been on.
    pub call_indicator: bool,
    /// Live activities from apps and scripts in the notch.
    pub live_activities: bool,
    /// Park files on the notch by dropping them there.
    pub file_shelf: bool,
    /// A large preview with buttons in place of the screenshot banner.
    pub screenshot_preview: bool,
    /// Which alerts show over a fullscreen app: one of FULLSCREEN_ALERTS.
    pub fullscreen_alerts: String,
    /// What opens the notch: one of OPEN_ON.
    pub open_on: String,
    /// Opens the notch and takes the keyboard, in GNOME's key syntax; empty for none.
    pub open_shortcut: String,
    /// Scroll for volume, swipe for songs and middle click for play/pause on the notch.
    pub gestures: bool,
}

impl Default for Behavior {
    fn default() -> Self {
        Behavior {
            open_delay_ms: 120,
            close_delay_ms: 300,
            move_clock: true,
            show_lyrics: true,
            replace_osd: true,
            osd_duration_ms: 1500,
            show_caps_lock: true,
            show_input_source: true,
            show_num_lock: false,
            all_monitors: true,
            device_alerts: true,
            alert_duration_ms: 3000,
            show_clock: true,
            clock_format: "system".into(),
            privacy_dots: true,
            call_indicator: true,
            live_activities: true,
            file_shelf: true,
            screenshot_preview: true,
            fullscreen_alerts: "important".into(),
            open_on: "hover".into(),
            open_shortcut: "<Super><Alt>n".into(),
            gestures: true,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct MediaConfig {
    /// The bars follow the music: noktad records what plays (`pw-record`)
    /// while a player plays.
    pub real_equalizer: bool,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(default)]
pub struct LyricsConfig {
    pub enabled: bool,
    /// A Korean or Japanese line gets a romanized line under it.
    pub romanize: bool,
}

impl Default for LyricsConfig {
    fn default() -> Self {
        LyricsConfig {
            enabled: true,
            romanize: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(default)]
pub struct TimerConfig {
    pub focus_minutes: u32,
    /// 0 means no break after focus.
    pub break_minutes: u32,
    pub long_break_minutes: u32,
    /// 0 means no long breaks.
    pub sessions_before_long_break: u32,
    pub sound: bool,
    /// No notification banners while a focus session runs.
    pub quiet_notifications: bool,
    /// Starts focus or stops the timer, as GNOME writes keys; empty for none.
    pub shortcut: String,
}

impl Default for TimerConfig {
    fn default() -> Self {
        TimerConfig {
            focus_minutes: 25,
            break_minutes: 5,
            long_break_minutes: 15,
            sessions_before_long_break: 4,
            sound: true,
            quiet_notifications: true,
            shortcut: "<Super><Alt>f".into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(default)]
pub struct NotificationsConfig {
    /// Show the banners GNOME would show in the notch instead.
    pub in_notch: bool,
    pub duration_ms: u32,
    /// Off shows only the app and the title.
    pub show_body: bool,
}

impl Default for NotificationsConfig {
    fn default() -> Self {
        NotificationsConfig {
            in_notch: true,
            duration_ms: 5000,
            show_body: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(default)]
pub struct ActivitiesConfig {
    /// An activity not updated for this long ends.
    pub stale_minutes: u32,
    /// Progress that apps report to the dock, and system updates, show as activities.
    pub auto_progress: bool,
}

impl Default for ActivitiesConfig {
    fn default() -> Self {
        ActivitiesConfig {
            stale_minutes: 30,
            auto_progress: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct CalendarConfig {
    pub enabled: bool,
    /// Minutes before an event to show it; 0 for no reminder.
    pub reminder_minutes: u32,
    /// How many events home lists, 1 to 5.
    pub agenda_size: u32,
    /// The closed notch counts down from the reminder to the start.
    pub countdown: bool,
}

impl Default for CalendarConfig {
    fn default() -> Self {
        CalendarConfig {
            enabled: true,
            reminder_minutes: 5,
            agenda_size: 3,
            countdown: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct ClipboardConfig {
    /// Keep a history of what is copied.
    pub enabled: bool,
    /// How many entries the history keeps besides the pinned ones.
    pub max_items: u32,
}

impl Default for ClipboardConfig {
    fn default() -> Self {
        ClipboardConfig {
            enabled: true,
            max_items: 25,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct HomeConfig {
    /// The quick toggles, in the order shown; names from [`HOME_TOGGLES`].
    pub toggles: Vec<String>,
    /// The tiles, in the order shown; names from [`HOME_TILES`].
    pub tiles: Vec<String>,
}

impl Default for HomeConfig {
    fn default() -> Self {
        HomeConfig {
            toggles: ["do_not_disturb", "caffeine", "dark_style"]
                .map(String::from)
                .to_vec(),
            tiles: ["notifications", "focus", "timer", "clipboard", "settings"]
                .map(String::from)
                .to_vec(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(default)]
pub struct WeatherConfig {
    pub enabled: bool,
    /// A place name, or coordinates like `-6.2,106.8`; empty means no weather.
    pub location: String,
    /// `celsius` or `fahrenheit`.
    pub units: String,
}

impl Default for WeatherConfig {
    fn default() -> Self {
        WeatherConfig {
            enabled: true,
            location: String::new(),
            units: "celsius".into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigError {
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

impl ConfigError {
    pub(super) fn invalid(message: String) -> ConfigError {
        ConfigError {
            message,
            line: None,
            column: None,
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.line, self.column) {
            (Some(line), Some(column)) => {
                write!(f, "line {line}, column {column}: {}", self.message)
            }
            _ => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for ConfigError {}

pub fn parse(text: &str) -> Result<Config, ConfigError> {
    let config: Config = toml::Deserializer::parse(text)
        .and_then(|de| {
            serde_ignored::deserialize(de, |path| {
                tracing::warn!("config.toml: unknown key `{path}` ignored");
            })
        })
        .map_err(|err| toml_error(text, &err))?;
    config.validate()?;
    Ok(config)
}

fn toml_error(text: &str, err: &toml::de::Error) -> ConfigError {
    let message = err.message().trim().to_owned();
    let Some(span) = err.span() else {
        return ConfigError::invalid(message);
    };
    let before = &text[..span.start.min(text.len())];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    ConfigError {
        message,
        line: Some(line),
        column: Some(column),
    }
}

impl Config {
    fn validate(&self) -> Result<(), ConfigError> {
        let a = &self.appearance;
        let b = &self.behavior;
        check_range("appearance.height", a.height, 16, 96)?;
        for (key, width) in [
            ("appearance.idle_width", a.idle_width),
            ("appearance.playing_width", a.playing_width),
            ("appearance.expanded_width", a.expanded_width),
            ("appearance.osd_width", a.osd_width),
        ] {
            check_range(key, width, a.height, 2000)?;
        }
        check_range(
            "appearance.expanded_height",
            a.expanded_height,
            a.height,
            2000,
        )?;
        check_range("appearance.corner_radius", a.corner_radius, 0, 64)?;
        check_range("appearance.ear_radius", a.ear_radius, 0, 64)?;
        check_color("appearance.background", &a.background)?;
        check_color("appearance.foreground", &a.foreground)?;
        check_color("appearance.accent", &a.accent)?;
        check_color("appearance.background_end", &a.background_end)?;
        check_float("appearance.animation_speed", a.animation_speed, 0.1, 5.0)?;
        check_float("appearance.picture_darken", a.picture_darken, 0.0, 0.8)?;
        check_range("appearance.picture_blur", a.picture_blur, 0, 40)?;
        check_float(
            "appearance.background_opacity",
            a.background_opacity,
            0.0,
            1.0,
        )?;
        if !THEMES.contains(&a.theme.as_str()) {
            return Err(ConfigError::invalid(format!(
                "appearance.theme must be one of {}, got {:?}",
                THEMES.map(|t| format!("{t:?}")).join(", "),
                a.theme
            )));
        }
        if !THEMES.contains(&a.light_theme.as_str()) {
            return Err(ConfigError::invalid(format!(
                "appearance.light_theme must be one of {}, got {:?}",
                THEMES.map(|t| format!("{t:?}")).join(", "),
                a.light_theme
            )));
        }
        if !GRADIENTS.contains(&a.gradient.as_str()) {
            return Err(ConfigError::invalid(format!(
                "appearance.gradient must be one of {}, got {:?}",
                GRADIENTS.map(|g| format!("{g:?}")).join(", "),
                a.gradient
            )));
        }
        if !CLOCK_FORMATS.contains(&b.clock_format.as_str()) {
            return Err(ConfigError::invalid(format!(
                "behavior.clock_format must be \"system\", \"24h\" or \"12h\", got {:?}",
                b.clock_format
            )));
        }
        if !FULLSCREEN_ALERTS.contains(&b.fullscreen_alerts.as_str()) {
            return Err(ConfigError::invalid(format!(
                "behavior.fullscreen_alerts must be \"none\", \"important\" or \"all\", got {:?}",
                b.fullscreen_alerts
            )));
        }
        if !OPEN_ON.contains(&b.open_on.as_str()) {
            return Err(ConfigError::invalid(format!(
                "behavior.open_on must be \"hover\" or \"click\", got {:?}",
                b.open_on
            )));
        }
        if !b.open_shortcut.is_empty() && !is_accelerator(&b.open_shortcut) {
            return Err(ConfigError::invalid(format!(
                "behavior.open_shortcut must be keys like \"<Super><Alt>n\" or empty, got {:?}",
                b.open_shortcut
            )));
        }
        check_range("behavior.open_delay_ms", b.open_delay_ms, 0, 5000)?;
        check_range("behavior.close_delay_ms", b.close_delay_ms, 0, 5000)?;
        check_range("behavior.osd_duration_ms", b.osd_duration_ms, 200, 10000)?;
        check_range(
            "behavior.alert_duration_ms",
            b.alert_duration_ms,
            500,
            15000,
        )?;
        check_range("timer.focus_minutes", self.timer.focus_minutes, 1, 180)?;
        check_range("timer.break_minutes", self.timer.break_minutes, 0, 60)?;
        check_range(
            "timer.long_break_minutes",
            self.timer.long_break_minutes,
            1,
            60,
        )?;
        check_range(
            "timer.sessions_before_long_break",
            self.timer.sessions_before_long_break,
            0,
            12,
        )?;
        check_range(
            "notifications.duration_ms",
            self.notifications.duration_ms,
            1000,
            30000,
        )?;
        check_range(
            "activities.stale_minutes",
            self.activities.stale_minutes,
            1,
            1440,
        )?;
        check_range(
            "calendar.reminder_minutes",
            self.calendar.reminder_minutes,
            0,
            60,
        )?;
        check_range("calendar.agenda_size", self.calendar.agenda_size, 1, 5)?;
        check_range("clipboard.max_items", self.clipboard.max_items, 5, 100)?;
        if !WEATHER_UNITS.contains(&self.weather.units.as_str()) {
            return Err(ConfigError::invalid(format!(
                "weather.units must be \"celsius\" or \"fahrenheit\", got {:?}",
                self.weather.units
            )));
        }
        check_names("home.toggles", &self.home.toggles, &HOME_TOGGLES, 3)?;
        check_names("home.tiles", &self.home.tiles, &HOME_TILES, 5)?;
        if !self.timer.shortcut.is_empty() && !is_accelerator(&self.timer.shortcut) {
            return Err(ConfigError::invalid(format!(
                "timer.shortcut must be keys like \"<Super><Alt>f\" or empty, got {:?}",
                self.timer.shortcut
            )));
        }
        Ok(())
    }
}

/// The names `home.toggles` accepts.
pub const HOME_TOGGLES: [&str; 4] = ["do_not_disturb", "caffeine", "dark_style", "night_light"];

/// The names `home.tiles` accepts.
pub const HOME_TILES: [&str; 6] = [
    "notifications",
    "focus",
    "timer",
    "clipboard",
    "settings",
    "screenshot",
];

/// At most `max` names from `known`, each once.
fn check_names(key: &str, names: &[String], known: &[&str], max: usize) -> Result<(), ConfigError> {
    let list = || {
        known
            .iter()
            .map(|n| format!("{n:?}"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    if let Some(name) = names.iter().find(|n| !known.contains(&n.as_str())) {
        return Err(ConfigError::invalid(format!(
            "{key} takes names from {}, got {name:?}",
            list()
        )));
    }
    if let Some((_, name)) = names
        .iter()
        .enumerate()
        .find(|(i, n)| names[..*i].contains(n))
    {
        return Err(ConfigError::invalid(format!("{key} has {name:?} twice")));
    }
    if names.len() > max {
        return Err(ConfigError::invalid(format!(
            "{key} takes at most {max} names, got {}",
            names.len()
        )));
    }
    Ok(())
}

/// The values `weather.units` accepts.
pub const WEATHER_UNITS: [&str; 2] = ["celsius", "fahrenheit"];

/// The values `appearance.theme` accepts.
pub const THEMES: [&str; 7] = [
    "midnight", "graphite", "glass", "aurora", "paper", "custom", "picture",
];

/// The values `appearance.gradient` accepts.
pub const GRADIENTS: [&str; 4] = ["none", "down", "across", "diagonal"];

/// The values `behavior.clock_format` accepts.
pub const CLOCK_FORMATS: [&str; 3] = ["system", "24h", "12h"];

/// The values `behavior.fullscreen_alerts` accepts.
pub const FULLSCREEN_ALERTS: [&str; 3] = ["none", "important", "all"];

/// The values `behavior.open_on` accepts.
pub const OPEN_ON: [&str; 2] = ["hover", "click"];

/// Modifiers in angle brackets, then one key name: `<Super><Alt>f`.
fn is_accelerator(value: &str) -> bool {
    let mut rest = value;
    while let Some(after) = rest.strip_prefix('<') {
        let Some((modifier, tail)) = after.split_once('>') else {
            return false;
        };
        if modifier.is_empty() || !modifier.chars().all(|c| c.is_ascii_alphanumeric()) {
            return false;
        }
        rest = tail;
    }
    !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn check_float(key: &str, value: f64, min: f64, max: f64) -> Result<(), ConfigError> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(ConfigError::invalid(format!(
            "{key} must be between {min:.1} and {max:.1}, got {value}"
        )))
    }
}

fn check_range(key: &str, value: u32, min: u32, max: u32) -> Result<(), ConfigError> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(ConfigError::invalid(format!(
            "{key} must be between {min} and {max}, got {value}"
        )))
    }
}

fn check_color(key: &str, value: &str) -> Result<(), ConfigError> {
    let valid = value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit());
    if valid {
        Ok(())
    } else {
        Err(ConfigError::invalid(format!(
            "{key} must be a color like \"#1a2b3c\", got {value:?}"
        )))
    }
}

/// One setting's value, as the settings window reads and changes it.
#[derive(Clone, Debug, PartialEq)]
pub enum SettingValue {
    Bool(bool),
    Uint(u32),
    Float(f64),
    Text(String),
    List(Vec<String>),
}

impl fmt::Display for SettingValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SettingValue::Bool(b) => write!(f, "{b}"),
            SettingValue::Uint(n) => write!(f, "{n}"),
            SettingValue::Float(n) => write!(f, "{n}"),
            SettingValue::Text(s) => write!(f, "{s:?}"),
            SettingValue::List(names) => write!(f, "{names:?}"),
        }
    }
}

impl From<bool> for SettingValue {
    fn from(b: bool) -> SettingValue {
        SettingValue::Bool(b)
    }
}

impl From<u32> for SettingValue {
    fn from(n: u32) -> SettingValue {
        SettingValue::Uint(n)
    }
}

impl From<f64> for SettingValue {
    fn from(n: f64) -> SettingValue {
        SettingValue::Float(n)
    }
}

impl From<&String> for SettingValue {
    fn from(s: &String) -> SettingValue {
        SettingValue::Text(s.clone())
    }
}

impl From<&Vec<String>> for SettingValue {
    fn from(names: &Vec<String>) -> SettingValue {
        SettingValue::List(names.clone())
    }
}

/// A table's keys and their values.
pub type Entries = Vec<(&'static str, SettingValue)>;

impl Appearance {
    pub fn entries(&self) -> Entries {
        vec![
            ("height", self.height.into()),
            ("idle_width", self.idle_width.into()),
            ("playing_width", self.playing_width.into()),
            ("expanded_width", self.expanded_width.into()),
            ("expanded_height", self.expanded_height.into()),
            ("corner_radius", self.corner_radius.into()),
            ("ear_radius", self.ear_radius.into()),
            ("background", (&self.background).into()),
            ("foreground", (&self.foreground).into()),
            ("use_album_accent", self.use_album_accent.into()),
            ("animation_speed", self.animation_speed.into()),
            ("osd_width", self.osd_width.into()),
            ("background_opacity", self.background_opacity.into()),
            ("accent", (&self.accent).into()),
            ("theme", (&self.theme).into()),
            ("progress_line", self.progress_line.into()),
            ("alert_glow", self.alert_glow.into()),
            ("depth", self.depth.into()),
            ("gradient", (&self.gradient).into()),
            ("background_end", (&self.background_end).into()),
            ("follow_system_style", self.follow_system_style.into()),
            ("light_theme", (&self.light_theme).into()),
            ("picture", (&self.picture).into()),
            ("picture_darken", self.picture_darken.into()),
            ("picture_blur", self.picture_blur.into()),
            ("cover_backdrop", self.cover_backdrop.into()),
        ]
    }
}

impl Behavior {
    pub fn entries(&self) -> Entries {
        vec![
            ("open_delay_ms", self.open_delay_ms.into()),
            ("close_delay_ms", self.close_delay_ms.into()),
            ("move_clock", self.move_clock.into()),
            ("show_lyrics", self.show_lyrics.into()),
            ("replace_osd", self.replace_osd.into()),
            ("osd_duration_ms", self.osd_duration_ms.into()),
            ("show_caps_lock", self.show_caps_lock.into()),
            ("show_input_source", self.show_input_source.into()),
            ("show_num_lock", self.show_num_lock.into()),
            ("all_monitors", self.all_monitors.into()),
            ("device_alerts", self.device_alerts.into()),
            ("alert_duration_ms", self.alert_duration_ms.into()),
            ("show_clock", self.show_clock.into()),
            ("clock_format", (&self.clock_format).into()),
            ("privacy_dots", self.privacy_dots.into()),
            ("call_indicator", self.call_indicator.into()),
            ("live_activities", self.live_activities.into()),
            ("file_shelf", self.file_shelf.into()),
            ("screenshot_preview", self.screenshot_preview.into()),
            ("fullscreen_alerts", (&self.fullscreen_alerts).into()),
            ("open_on", (&self.open_on).into()),
            ("open_shortcut", (&self.open_shortcut).into()),
            ("gestures", self.gestures.into()),
        ]
    }
}

impl TimerConfig {
    pub fn entries(&self) -> Entries {
        vec![
            ("focus_minutes", self.focus_minutes.into()),
            ("break_minutes", self.break_minutes.into()),
            ("long_break_minutes", self.long_break_minutes.into()),
            (
                "sessions_before_long_break",
                self.sessions_before_long_break.into(),
            ),
            ("sound", self.sound.into()),
            ("quiet_notifications", self.quiet_notifications.into()),
            ("shortcut", (&self.shortcut).into()),
        ]
    }
}

impl NotificationsConfig {
    pub fn entries(&self) -> Entries {
        vec![
            ("in_notch", self.in_notch.into()),
            ("duration_ms", self.duration_ms.into()),
            ("show_body", self.show_body.into()),
        ]
    }
}

impl ActivitiesConfig {
    pub fn entries(&self) -> Entries {
        vec![
            ("stale_minutes", self.stale_minutes.into()),
            ("auto_progress", self.auto_progress.into()),
        ]
    }
}

impl CalendarConfig {
    pub fn entries(&self) -> Entries {
        vec![
            ("enabled", self.enabled.into()),
            ("reminder_minutes", self.reminder_minutes.into()),
            ("agenda_size", self.agenda_size.into()),
            ("countdown", self.countdown.into()),
        ]
    }
}

impl ClipboardConfig {
    pub fn entries(&self) -> Entries {
        vec![
            ("enabled", self.enabled.into()),
            ("max_items", self.max_items.into()),
        ]
    }
}

impl HomeConfig {
    pub fn entries(&self) -> Entries {
        vec![
            ("toggles", (&self.toggles).into()),
            ("tiles", (&self.tiles).into()),
        ]
    }
}

impl WeatherConfig {
    pub fn entries(&self) -> Entries {
        vec![
            ("enabled", self.enabled.into()),
            ("location", (&self.location).into()),
            ("units", (&self.units).into()),
        ]
    }
}

impl MediaConfig {
    pub fn entries(&self) -> Entries {
        vec![("real_equalizer", self.real_equalizer.into())]
    }
}

impl LyricsConfig {
    pub fn entries(&self) -> Entries {
        vec![
            ("enabled", self.enabled.into()),
            ("romanize", self.romanize.into()),
        ]
    }
}
