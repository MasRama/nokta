//! Reads the counters from Linux's `/proc` and `/sys`.

use std::fs;
use std::path::{Path, PathBuf};

use super::model::{
    cpu_sensor, largest_rss, parse_meminfo, parse_millidegrees, parse_net_dev, parse_stat,
    parse_status,
};
use super::service::{MemoryLow, Reading, Source};

pub struct Proc {
    /// The CPU sensor's first `temp*_input`, found once at start.
    sensor: Option<PathBuf>,
}

impl Proc {
    pub fn new() -> Proc {
        let sensor = find_sensor(Path::new("/sys/class/hwmon"));
        match &sensor {
            Some(path) => tracing::debug!("CPU temperature from {}", path.display()),
            None => tracing::info!("no CPU temperature sensor"),
        }
        Proc { sensor }
    }
}

impl Default for Proc {
    fn default() -> Self {
        Proc::new()
    }
}

impl Source for Proc {
    fn read(&self) -> Reading {
        let text = |path: &str| fs::read_to_string(path).ok();
        Reading {
            cpu: text("/proc/stat").as_deref().and_then(parse_stat),
            memory: text("/proc/meminfo").as_deref().and_then(parse_meminfo),
            temperature: self
                .sensor
                .as_ref()
                .and_then(|path| fs::read_to_string(path).ok())
                .as_deref()
                .and_then(parse_millidegrees),
            net: text("/proc/net/dev").as_deref().map(parse_net_dev),
        }
    }

    fn memory_low(&self) -> MemoryLow {
        let (used, total) = fs::read_to_string("/proc/meminfo")
            .ok()
            .as_deref()
            .and_then(parse_meminfo)
            .unwrap_or_default();
        MemoryLow {
            used,
            total,
            app: largest_app().unwrap_or_default(),
        }
    }
}

/// The `temp*_input` with the lowest number of the preferred CPU chip.
fn find_sensor(hwmon: &Path) -> Option<PathBuf> {
    let chips: Vec<(String, String)> = fs::read_dir(hwmon)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = fs::read_to_string(entry.path().join("name")).ok()?;
            Some((entry.path().display().to_string(), name.trim().to_owned()))
        })
        .collect();
    let pairs: Vec<(&str, &str)> = chips
        .iter()
        .map(|(id, name)| (id.as_str(), name.as_str()))
        .collect();
    let chip = PathBuf::from(cpu_sensor(&pairs)?);
    let mut inputs: Vec<(u32, PathBuf)> = fs::read_dir(&chip)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let n = name
                .strip_prefix("temp")?
                .strip_suffix("_input")?
                .parse()
                .ok()?;
            Some((n, entry.path()))
        })
        .collect();
    inputs.sort();
    inputs.into_iter().next().map(|(_, path)| path)
}

/// The name of the process with the most resident memory, from one scan of
/// `/proc/*/status`.
fn largest_app() -> Option<String> {
    let apps = fs::read_dir("/proc").ok()?.flatten().filter_map(|entry| {
        let pid = entry.file_name();
        if !pid.to_str()?.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        parse_status(&fs::read_to_string(entry.path().join("status")).ok()?)
    });
    largest_rss(apps)
}
