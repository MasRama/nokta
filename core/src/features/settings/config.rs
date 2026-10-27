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
    pub lyrics: LyricsConfig,
    pub timer: TimerConfig,
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
    pub all_monitors: bool,
    pub device_alerts: bool,
    pub alert_duration_ms: u32,
    pub show_clock: bool,
    pub clock_format: String,
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
            all_monitors: true,
            device_alerts: true,
            alert_duration_ms: 3000,
            show_clock: true,
            clock_format: "system".into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(default)]
pub struct LyricsConfig {
    pub enabled: bool,
}

impl Default for LyricsConfig {
    fn default() -> Self {
        LyricsConfig { enabled: true }
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
        check_float("appearance.animation_speed", a.animation_speed, 0.1, 5.0)?;
        check_float(
            "appearance.background_opacity",
            a.background_opacity,
            0.0,
            1.0,
        )?;
        if !CLOCK_FORMATS.contains(&b.clock_format.as_str()) {
            return Err(ConfigError::invalid(format!(
                "behavior.clock_format must be \"system\", \"24h\" or \"12h\", got {:?}",
                b.clock_format
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
        Ok(())
    }
}

/// The values `behavior.clock_format` accepts.
pub const CLOCK_FORMATS: [&str; 3] = ["system", "24h", "12h"];

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
}

impl fmt::Display for SettingValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SettingValue::Bool(b) => write!(f, "{b}"),
            SettingValue::Uint(n) => write!(f, "{n}"),
            SettingValue::Float(n) => write!(f, "{n}"),
            SettingValue::Text(s) => write!(f, "{s:?}"),
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
            ("all_monitors", self.all_monitors.into()),
            ("device_alerts", self.device_alerts.into()),
            ("alert_duration_ms", self.alert_duration_ms.into()),
            ("show_clock", self.show_clock.into()),
            ("clock_format", (&self.clock_format).into()),
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
        ]
    }
}

impl LyricsConfig {
    pub fn entries(&self) -> Entries {
        vec![("enabled", self.enabled.into())]
    }
}
