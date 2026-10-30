use std::time::{Duration, Instant};

use super::model::*;

const STAT: &str = "cpu  100 5 50 800 40 0 5 0 0 0\n\
                    cpu0 50 2 25 400 20 0 3 0 0 0\n\
                    intr 12345\n";

#[test]
fn cpu_times_come_from_the_first_line() {
    let times = parse_stat(STAT).unwrap();
    // idle and iowait are idle; the guest columns are already in user.
    assert_eq!(
        times,
        CpuTimes {
            idle: 840,
            total: 1000
        }
    );
    assert_eq!(parse_stat("intr 1\n"), None);
    assert_eq!(parse_stat("cpu  x y\n"), None);
}

#[test]
fn cpu_usage_is_the_busy_share_between_two_readings() {
    let a = CpuTimes {
        idle: 840,
        total: 1000,
    };
    let b = CpuTimes {
        idle: 900,
        total: 1200,
    };
    assert!((cpu_usage(&a, &b) - 0.7).abs() < 1e-9);
    // No time passed, or the counters went back: nothing to tell.
    assert_eq!(cpu_usage(&a, &a), 0.0);
    assert_eq!(cpu_usage(&b, &a), 0.0);
}

#[test]
fn memory_used_is_total_less_available() {
    let text = "MemTotal:       16000000 kB\n\
                MemFree:         1000000 kB\n\
                MemAvailable:    6000000 kB\n";
    assert_eq!(
        parse_meminfo(text),
        Some((10_000_000 * 1024, 16_000_000 * 1024))
    );
    assert_eq!(parse_meminfo("MemTotal: 10 kB\n"), None);
}

#[test]
fn network_counts_every_interface_but_loopback() {
    let text = "Inter-|   Receive                                                |  Transmit\n \
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    \
    lo: 9999 10 0 0 0 0 0 0 9999 10 0 0 0 0 0 0\n  \
  eth0: 1000 10 0 0 0 0 0 0 200 5 0 0 0 0 0 0\n\
wlan0:500 3 0 0 0 0 0 0 30 1 0 0 0 0 0 0\n";
    assert_eq!(parse_net_dev(text), (1500, 230));
    assert_eq!(parse_net_dev(""), (0, 0));
}

#[test]
fn a_rate_is_bytes_a_second() {
    assert_eq!(rate(1000, 3000, 2.0), 1000.0);
    // A counter that went back (an interface gone) or no time: zero.
    assert_eq!(rate(3000, 1000, 2.0), 0.0);
    assert_eq!(rate(1000, 3000, 0.0), 0.0);
}

#[test]
fn the_cpu_sensor_is_picked_by_preference() {
    let chips = [
        ("hwmon0", "nvme"),
        ("hwmon1", "acpitz_0"),
        ("hwmon2", "coretemp"),
        ("hwmon3", "iwlwifi_1_5"),
    ];
    assert_eq!(cpu_sensor(&chips), Some("hwmon2"));
    assert_eq!(cpu_sensor(&chips[..2]), Some("hwmon1"));
    assert_eq!(cpu_sensor(&[("hwmon0", "nvme")]), None);
    assert_eq!(
        cpu_sensor(&[("a", "acpitz"), ("b", "k10temp"), ("c", "zenpower")]),
        Some("b")
    );
}

#[test]
fn a_sensor_reads_millidegrees() {
    assert_eq!(parse_millidegrees("45500\n"), Some(45.5));
    assert_eq!(parse_millidegrees("junk"), None);
}

#[test]
fn the_largest_app_is_the_one_using_the_most_memory() {
    let status = "Name:\tfirefox\nUmask:\t0022\nVmRSS:\t  6200000 kB\n";
    assert_eq!(
        parse_status(status),
        Some(("firefox".into(), 6_200_000 * 1024))
    );
    // Kernel threads have no VmRSS.
    assert_eq!(parse_status("Name:\tkthreadd\n"), None);
    let apps = [
        ("a".to_string(), 10),
        ("b".to_string(), 30),
        ("c".to_string(), 20),
    ];
    assert_eq!(largest_rss(apps), Some("b".into()));
    assert_eq!(largest_rss(Vec::<(String, u64)>::new()), None);
}

#[test]
fn watchers_count_each_watch() {
    let mut w = Watchers::default();
    assert!(!w.running());
    assert!(w.add(":1.5"));
    assert!(w.add(":1.5"));
    assert!(w.remove(":1.5"), "one watch is left");
    assert!(!w.remove(":1.5"));
    // An unwatch that was never watched changes nothing.
    assert!(!w.remove(":1.9"));
    assert!(!w.running());
}

#[test]
fn a_watcher_leaving_the_bus_drops_all_its_watches() {
    let mut w = Watchers::default();
    w.add(":1.5");
    w.add(":1.5");
    w.add(":1.6");
    assert!(w.drop_name(":1.5"));
    assert!(!w.drop_name(":1.6"));
    assert!(!w.running());
}

#[test]
fn the_memory_alert_waits_ten_minutes_between_alerts() {
    let mut gate = AlertGate::default();
    let t = Instant::now();
    assert!(gate.allow(t));
    assert!(!gate.allow(t + Duration::from_secs(60)));
    assert!(gate.allow(t + ALERT_GAP));
}

mod service {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use tokio::sync::{mpsc, watch};

    use super::super::model::{CpuTimes, Usage};
    use super::super::service::{self, Command, Handle, MemoryLow, Reading, Source};
    use crate::features::settings::SystemConfig;

    /// Each reading is 100 ticks later, half of them idle, and 1000 bytes
    /// more each way.
    #[derive(Default)]
    struct Fake {
        reads: AtomicU64,
    }

    impl Source for Fake {
        fn read(&self) -> Reading {
            let n = self.reads.fetch_add(1, Ordering::SeqCst) + 1;
            Reading {
                cpu: Some(CpuTimes {
                    idle: 50 * n,
                    total: 100 * n,
                }),
                memory: Some((5, 10)),
                temperature: Some(40.0),
                net: Some((1000 * n, 1000 * n)),
            }
        }

        fn memory_low(&self) -> MemoryLow {
            MemoryLow {
                used: 9,
                total: 10,
                app: "firefox".into(),
            }
        }
    }

    fn start(
        memory_alert: bool,
    ) -> (
        Arc<Fake>,
        Handle,
        mpsc::UnboundedSender<()>,
        watch::Sender<SystemConfig>,
    ) {
        let fake = Arc::new(Fake::default());
        let (config_tx, config) = watch::channel(SystemConfig { memory_alert });
        let (pressure_tx, pressure) = mpsc::unbounded_channel();
        let handle = service::spawn(fake.clone(), config, pressure);
        (fake, handle, pressure_tx, config_tx)
    }

    async fn changed(usage: &mut watch::Receiver<Usage>) -> Usage {
        tokio::time::timeout(Duration::from_secs(3), usage.changed())
            .await
            .expect("no new Usage")
            .unwrap();
        *usage.borrow_and_update()
    }

    #[tokio::test]
    async fn nothing_is_read_until_someone_watches() {
        let (fake, mut handle, _pressure, _config) = start(true);
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(fake.reads.load(Ordering::SeqCst), 0);

        handle
            .commands
            .send(Command::Watch(":1.1".into()))
            .await
            .unwrap();
        let usage = changed(&mut handle.usage).await;
        assert_eq!(usage.cpu, 0.5);
        assert_eq!((usage.memory_used, usage.memory_total), (5, 10));
        assert_eq!(usage.temperature, 40.0);
        assert!(usage.download > 0.0 && usage.upload > 0.0, "{usage:?}");

        handle
            .commands
            .send(Command::Unwatch(":1.1".into()))
            .await
            .unwrap();
        let usage = changed(&mut handle.usage).await;
        assert_eq!(usage.memory_total, 0, "stopped is all zero");
        let reads = fake.reads.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(2500)).await;
        assert_eq!(fake.reads.load(Ordering::SeqCst), reads);
    }

    #[tokio::test]
    async fn a_watcher_leaving_the_bus_stops_sampling() {
        let (fake, mut handle, _pressure, _config) = start(true);
        handle
            .commands
            .send(Command::Watch(":1.1".into()))
            .await
            .unwrap();
        handle
            .commands
            .send(Command::Watch(":1.1".into()))
            .await
            .unwrap();
        changed(&mut handle.usage).await;
        handle
            .commands
            .send(Command::Gone(":1.1".into()))
            .await
            .unwrap();
        assert_eq!(changed(&mut handle.usage).await.memory_total, 0);
        let reads = fake.reads.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(2500)).await;
        assert_eq!(fake.reads.load(Ordering::SeqCst), reads);
    }

    #[tokio::test]
    async fn memory_pressure_alerts_once_in_a_while() {
        let (_fake, mut handle, pressure, _config) = start(true);
        pressure.send(()).unwrap();
        pressure.send(()).unwrap();
        let low = tokio::time::timeout(Duration::from_secs(2), handle.memory_low.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(low.app, "firefox");
        assert_eq!((low.used, low.total), (9, 10));
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(handle.memory_low.try_recv().is_err(), "the second waits");
    }

    #[tokio::test]
    async fn no_memory_alert_while_it_is_off() {
        let (_fake, mut handle, pressure, _config) = start(false);
        pressure.send(()).unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(handle.memory_low.try_recv().is_err());
    }
}
