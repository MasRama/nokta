//! Reading the system's counters: CPU, memory, temperature and network from
//! the text of `/proc` and `/sys`, the rates between two readings, and who
//! is watching.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// The memory alert shows at most once in this long.
pub const ALERT_GAP: Duration = Duration::from_secs(10 * 60);

/// CPU sensor chips in `/sys/class/hwmon`, best first.
const CPU_SENSORS: [&str; 5] = ["k10temp", "coretemp", "zenpower", "cpu_thermal", "acpitz"];

/// One sample as `io.nokta.System1.Usage` publishes it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Usage {
    /// 0 to 1.
    pub cpu: f64,
    pub memory_used: u64,
    pub memory_total: u64,
    /// °C, NaN when unknown.
    pub temperature: f64,
    /// Bytes a second.
    pub download: f64,
    pub upload: f64,
}

impl Default for Usage {
    /// Nothing sampled.
    fn default() -> Self {
        Usage {
            cpu: 0.0,
            memory_used: 0,
            memory_total: 0,
            temperature: f64::NAN,
            download: 0.0,
            upload: 0.0,
        }
    }
}

/// The CPU's idle and total time since boot, in clock ticks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CpuTimes {
    pub idle: u64,
    pub total: u64,
}

/// All CPUs' times from `/proc/stat`.
pub fn parse_stat(text: &str) -> Option<CpuTimes> {
    let line = text.lines().find(|l| l.starts_with("cpu "))?;
    let fields: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    // user nice system idle iowait irq softirq steal; guest time is already
    // counted in user and nice.
    let total = fields.iter().take(8).sum();
    let idle = fields.get(3)? + fields.get(4).unwrap_or(&0);
    Some(CpuTimes { idle, total })
}

/// The share of time the CPUs were busy between two readings.
pub fn cpu_usage(prev: &CpuTimes, now: &CpuTimes) -> f64 {
    let total = now.total.saturating_sub(prev.total);
    let idle = now.idle.saturating_sub(prev.idle);
    if total == 0 {
        return 0.0;
    }
    (total.saturating_sub(idle) as f64 / total as f64).clamp(0.0, 1.0)
}

/// Memory used and total in bytes from `/proc/meminfo`; used is what is not
/// available.
pub fn parse_meminfo(text: &str) -> Option<(u64, u64)> {
    let kib = |key: &str| -> Option<u64> {
        let line = text.lines().find(|l| l.starts_with(key))?;
        line[key.len()..].split_whitespace().next()?.parse().ok()
    };
    let total = kib("MemTotal:")? * 1024;
    let available = kib("MemAvailable:")? * 1024;
    Some((total.saturating_sub(available), total))
}

/// Bytes received and sent by every interface but loopback, from
/// `/proc/net/dev`.
pub fn parse_net_dev(text: &str) -> (u64, u64) {
    let mut sum = (0, 0);
    for line in text.lines() {
        let Some((name, counters)) = line.split_once(':') else {
            continue;
        };
        if name.trim() == "lo" {
            continue;
        }
        let fields: Vec<u64> = counters
            .split_whitespace()
            .filter_map(|f| f.parse().ok())
            .collect();
        if let (Some(rx), Some(tx)) = (fields.first(), fields.get(8)) {
            sum.0 += rx;
            sum.1 += tx;
        }
    }
    sum
}

/// The CPU's times from Windows' `GetSystemTimes`, in 100 ns units: its
/// kernel time counts the idle time too.
pub fn windows_cpu_times(idle: u64, kernel: u64, user: u64) -> CpuTimes {
    CpuTimes {
        idle,
        total: kernel + user,
    }
}

/// One network interface from Windows' `GetIfTable2`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Interface {
    /// A real adapter, not a filter or a tunnel that repeats its traffic.
    pub hardware: bool,
    pub filter: bool,
    pub loopback: bool,
    pub up: bool,
    pub received: u64,
    pub sent: u64,
}

/// Bytes received and sent by the hardware interfaces that are up; the
/// filters stacked on them would count the same bytes again.
pub fn windows_net(interfaces: impl IntoIterator<Item = Interface>) -> (u64, u64) {
    interfaces
        .into_iter()
        .filter(|i| i.hardware && !i.filter && !i.loopback && i.up)
        .fold((0, 0), |(rx, tx), i| (rx + i.received, tx + i.sent))
}

/// The name an app goes by from its executable's path, as `chrome` for
/// `C:\...\chrome.exe`.
pub fn app_name(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let end = file.len().checked_sub(4).filter(|&end| {
        file.get(end..)
            .is_some_and(|ext| ext.eq_ignore_ascii_case(".exe"))
    });
    end.map_or(file, |end| &file[..end]).to_owned()
}

/// Bytes a second between two counters `secs` apart; zero when the counter
/// went back.
pub fn rate(prev: u64, now: u64, secs: f64) -> f64 {
    if secs <= 0.0 || now < prev {
        return 0.0;
    }
    (now - prev) as f64 / secs
}

/// The chip to read the CPU's temperature from, out of `(id, name)` pairs.
/// Names may carry a suffix, as `acpitz_0`.
pub fn cpu_sensor<'a>(chips: &[(&'a str, &str)]) -> Option<&'a str> {
    CPU_SENSORS.iter().find_map(|wanted| {
        chips.iter().find_map(|(id, name)| {
            let matches = *name == *wanted
                || name
                    .strip_prefix(wanted)
                    .is_some_and(|rest| rest.starts_with('_'));
            matches.then_some(*id)
        })
    })
}

/// A `temp*_input` file's millidegrees as °C.
pub fn parse_millidegrees(text: &str) -> Option<f64> {
    text.trim().parse::<i64>().ok().map(|m| m as f64 / 1000.0)
}

/// A process's name and resident memory in bytes from `/proc/<pid>/status`;
/// none for a kernel thread.
pub fn parse_status(text: &str) -> Option<(String, u64)> {
    let field = |key: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(key))
            .map(str::trim)
    };
    let name = field("Name:")?.to_owned();
    let rss: u64 = field("VmRSS:")?.split_whitespace().next()?.parse().ok()?;
    Some((name, rss * 1024))
}

/// The name of the process using the most memory.
pub fn largest_rss(apps: impl IntoIterator<Item = (String, u64)>) -> Option<String> {
    apps.into_iter()
        .max_by_key(|(_, rss)| *rss)
        .map(|(name, _)| name)
}

/// Who is watching, by D-Bus sender, and how many times.
#[derive(Debug, Default)]
pub struct Watchers {
    counts: HashMap<String, u32>,
}

impl Watchers {
    /// One more watch from `sender`; whether sampling runs.
    pub fn add(&mut self, sender: &str) -> bool {
        *self.counts.entry(sender.to_owned()).or_default() += 1;
        self.running()
    }

    /// One watch less from `sender`; whether sampling runs.
    pub fn remove(&mut self, sender: &str) -> bool {
        if let Some(count) = self.counts.get_mut(sender) {
            *count -= 1;
            if *count == 0 {
                self.counts.remove(sender);
            }
        }
        self.running()
    }

    /// `name` left the bus, with all its watches; whether sampling runs.
    pub fn drop_name(&mut self, name: &str) -> bool {
        self.counts.remove(name);
        self.running()
    }

    pub fn running(&self) -> bool {
        !self.counts.is_empty()
    }
}

/// Lets the memory alert through at most once in [`ALERT_GAP`].
#[derive(Debug, Default)]
pub struct AlertGate {
    last: Option<Instant>,
}

impl AlertGate {
    pub fn allow(&mut self, now: Instant) -> bool {
        if self.last.is_some_and(|last| now < last + ALERT_GAP) {
            return false;
        }
        self.last = Some(now);
        true
    }
}
