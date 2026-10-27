//! The config model, its defaults and validation.

use std::collections::HashMap;
use std::fmt;

use serde::Deserialize;
use zbus::zvariant::{OwnedValue, Str};

/// The commented default file written on first run. It parses to [`Config::default`].
pub const DEFAULT_CONFIG_TOML: &str = include_str!("default_config.toml");

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct Config {
    pub appearance: Appearance,
    pub behavior: Behavior,
    pub lyrics: LyricsConfig,
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigError {
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

impl ConfigError {
    fn invalid(message: String) -> ConfigError {
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
        if !(0.1..=5.0).contains(&a.animation_speed) {
            return Err(ConfigError::invalid(format!(
                "appearance.animation_speed must be between 0.1 and 5.0, got {}",
                a.animation_speed
            )));
        }
        check_range("behavior.open_delay_ms", b.open_delay_ms, 0, 5000)?;
        check_range("behavior.close_delay_ms", b.close_delay_ms, 0, 5000)?;
        check_range("behavior.osd_duration_ms", b.osd_duration_ms, 200, 10000)?;
        Ok(())
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

fn string_value(s: &str) -> OwnedValue {
    OwnedValue::from(Str::from(s.to_owned()))
}

impl Appearance {
    pub fn to_dbus(&self) -> HashMap<String, OwnedValue> {
        HashMap::from([
            ("height".into(), self.height.into()),
            ("idle_width".into(), self.idle_width.into()),
            ("playing_width".into(), self.playing_width.into()),
            ("expanded_width".into(), self.expanded_width.into()),
            ("expanded_height".into(), self.expanded_height.into()),
            ("corner_radius".into(), self.corner_radius.into()),
            ("ear_radius".into(), self.ear_radius.into()),
            ("background".into(), string_value(&self.background)),
            ("foreground".into(), string_value(&self.foreground)),
            ("use_album_accent".into(), self.use_album_accent.into()),
            ("animation_speed".into(), self.animation_speed.into()),
            ("osd_width".into(), self.osd_width.into()),
        ])
    }
}

impl Behavior {
    pub fn to_dbus(&self) -> HashMap<String, OwnedValue> {
        HashMap::from([
            ("open_delay_ms".into(), self.open_delay_ms.into()),
            ("close_delay_ms".into(), self.close_delay_ms.into()),
            ("move_clock".into(), self.move_clock.into()),
            ("show_lyrics".into(), self.show_lyrics.into()),
            ("replace_osd".into(), self.replace_osd.into()),
            ("osd_duration_ms".into(), self.osd_duration_ms.into()),
            ("show_caps_lock".into(), self.show_caps_lock.into()),
            ("all_monitors".into(), self.all_monitors.into()),
        ])
    }
}
