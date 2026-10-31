use super::rules::{
    cod_class, is_audio, windows_battery, Alert, BatteryRules, BatterySample, BluetoothRules,
    DeviceChange, Kind, Step,
};

fn sample(on_battery: bool, percentage: f64) -> BatterySample {
    BatterySample {
        present: true,
        on_battery,
        full: false,
        percentage,
    }
}

fn kinds(alerts: &[Alert]) -> Vec<Kind> {
    alerts.iter().map(|a| a.kind).collect()
}

#[test]
fn first_battery_sample_is_silent() {
    let mut rules = BatteryRules::default();
    assert!(rules.update(sample(true, 5.0)).is_empty());
    assert!(rules.update(sample(true, 4.0)).is_empty());
}

#[test]
fn charger_plugged_and_unplugged() {
    let mut rules = BatteryRules::default();
    rules.update(sample(true, 76.0));
    assert_eq!(
        rules.update(sample(false, 76.4)),
        vec![Alert::battery(Kind::ChargerPlugged, 76)]
    );
    assert!(rules.update(sample(false, 77.0)).is_empty());
    assert_eq!(
        rules.update(sample(true, 77.0)),
        vec![Alert::battery(Kind::ChargerUnplugged, 77)]
    );
}

#[test]
fn low_fires_once_while_discharging() {
    let mut rules = BatteryRules::default();
    rules.update(sample(true, 22.0));
    assert!(rules.update(sample(true, 21.0)).is_empty());
    assert_eq!(
        rules.update(sample(true, 20.0)),
        vec![Alert::battery(Kind::BatteryLow, 20)]
    );
    assert!(rules.update(sample(true, 19.0)).is_empty());
}

#[test]
fn critical_fires_once_and_covers_low() {
    let mut rules = BatteryRules::default();
    rules.update(sample(true, 25.0));
    assert_eq!(
        kinds(&rules.update(sample(true, 20.0))),
        vec![Kind::BatteryLow]
    );
    assert_eq!(
        rules.update(sample(true, 10.0)),
        vec![Alert::battery(Kind::BatteryCritical, 10)]
    );
    assert!(rules.update(sample(true, 9.0)).is_empty());

    // A sudden drop past both thresholds sends only critical.
    let mut rules = BatteryRules::default();
    rules.update(sample(true, 30.0));
    assert_eq!(
        kinds(&rules.update(sample(true, 8.0))),
        vec![Kind::BatteryCritical]
    );
    assert!(rules.update(sample(true, 15.0)).is_empty());
}

#[test]
fn no_low_alert_while_charging() {
    let mut rules = BatteryRules::default();
    rules.update(sample(false, 30.0));
    assert!(rules.update(sample(false, 15.0)).is_empty());
}

#[test]
fn thresholds_rearm_above_them() {
    let mut rules = BatteryRules::default();
    rules.update(sample(true, 21.0));
    assert_eq!(
        kinds(&rules.update(sample(true, 20.0))),
        vec![Kind::BatteryLow]
    );
    assert_eq!(
        kinds(&rules.update(sample(false, 20.0))),
        vec![Kind::ChargerPlugged]
    );
    rules.update(sample(false, 21.0));
    assert_eq!(
        kinds(&rules.update(sample(true, 21.0))),
        vec![Kind::ChargerUnplugged]
    );
    assert_eq!(
        kinds(&rules.update(sample(true, 20.0))),
        vec![Kind::BatteryLow]
    );
}

#[test]
fn unplugging_below_low_sends_both_in_order() {
    let mut rules = BatteryRules::default();
    rules.update(sample(false, 50.0));
    rules.update(sample(false, 18.0));
    assert_eq!(
        kinds(&rules.update(sample(true, 18.0))),
        vec![Kind::ChargerUnplugged, Kind::BatteryLow]
    );
}

#[test]
fn full_fires_once_on_ac() {
    let full = BatterySample {
        full: true,
        ..sample(false, 100.0)
    };
    let mut rules = BatteryRules::default();
    rules.update(sample(false, 99.0));
    assert_eq!(
        rules.update(full),
        vec![Alert::battery(Kind::BatteryFull, 100)]
    );
    assert!(rules.update(full).is_empty());
    rules.update(sample(false, 99.0));
    assert_eq!(kinds(&rules.update(full)), vec![Kind::BatteryFull]);
}

#[test]
fn full_at_startup_is_silent() {
    let full = BatterySample {
        full: true,
        ..sample(false, 100.0)
    };
    let mut rules = BatteryRules::default();
    assert!(rules.update(full).is_empty());
    assert!(rules.update(full).is_empty());
}

#[test]
fn no_battery_no_alerts() {
    let gone = BatterySample {
        present: false,
        ..sample(true, 0.0)
    };
    let mut rules = BatteryRules::default();
    rules.update(gone);
    assert!(rules
        .update(BatterySample {
            on_battery: false,
            ..gone
        })
        .is_empty());
    assert!(rules.update(gone).is_empty());
    // A battery that shows up later starts silent.
    assert!(rules.update(sample(true, 5.0)).is_empty());
}

#[test]
fn audio_devices_by_icon_or_class() {
    assert!(is_audio("audio-headphones", 0));
    assert!(is_audio("audio-headset", 0));
    assert!(is_audio("", 0x240404));
    assert!(!is_audio("input-mouse", 0x002580));
    assert!(!is_audio("phone", 0x5a020c));
    assert!(!is_audio("", 0));
}

fn buds(connected: bool) -> DeviceChange {
    DeviceChange {
        alias: Some("Galaxy Buds2".into()),
        icon: Some("audio-headset".into()),
        class: None,
        connected: Some(connected),
    }
}

fn connected(value: bool) -> DeviceChange {
    DeviceChange {
        connected: Some(value),
        ..DeviceChange::default()
    }
}

const BUDS: &str = "/org/bluez/hci0/dev_AA";

#[test]
fn known_devices_are_silent() {
    let mut rules = BluetoothRules::default();
    rules.add(BUDS, buds(true));
    assert_eq!(rules.change(BUDS, connected(true)), None);
}

#[test]
fn connect_with_known_battery_alerts_at_once() {
    let mut rules = BluetoothRules::default();
    rules.add(BUDS, buds(false));
    assert_eq!(rules.battery(BUDS, Some(82)), None);
    assert_eq!(
        rules.change(BUDS, connected(true)),
        Some(Step::Alert(Alert::device(
            Kind::BluetoothConnected,
            "Galaxy Buds2",
            82
        )))
    );
}

#[test]
fn connect_waits_for_battery() {
    let mut rules = BluetoothRules::default();
    rules.add(BUDS, buds(false));
    let Some(Step::Wait(wait)) = rules.change(BUDS, connected(true)) else {
        panic!("expected a wait");
    };
    assert_eq!(
        rules.battery(BUDS, Some(64)),
        Some(Alert::device(Kind::BluetoothConnected, "Galaxy Buds2", 64))
    );
    assert_eq!(rules.wait_ended(BUDS, wait), None);
    assert_eq!(rules.battery(BUDS, Some(63)), None);
}

#[test]
fn wait_ends_without_battery() {
    let mut rules = BluetoothRules::default();
    rules.add(BUDS, buds(false));
    let Some(Step::Wait(wait)) = rules.change(BUDS, connected(true)) else {
        panic!("expected a wait");
    };
    assert_eq!(
        rules.wait_ended(BUDS, wait),
        Some(Alert::device(Kind::BluetoothConnected, "Galaxy Buds2", -1))
    );
    assert_eq!(rules.wait_ended(BUDS, wait), None);
}

#[test]
fn disconnect_cancels_wait_and_forgets_battery() {
    let mut rules = BluetoothRules::default();
    rules.add(BUDS, buds(false));
    let Some(Step::Wait(first)) = rules.change(BUDS, connected(true)) else {
        panic!("expected a wait");
    };
    assert_eq!(
        rules.change(BUDS, connected(false)),
        Some(Step::Alert(Alert::device(
            Kind::BluetoothDisconnected,
            "Galaxy Buds2",
            -1
        )))
    );
    assert_eq!(rules.wait_ended(BUDS, first), None);

    rules.battery(BUDS, Some(50));
    rules.change(BUDS, connected(true));
    rules.change(BUDS, connected(false));
    // The battery from the last connection is not reused.
    assert!(matches!(
        rules.change(BUDS, connected(true)),
        Some(Step::Wait(_))
    ));
}

#[test]
fn stale_wait_from_an_earlier_connection_is_ignored() {
    let mut rules = BluetoothRules::default();
    rules.add(BUDS, buds(false));
    let Some(Step::Wait(first)) = rules.change(BUDS, connected(true)) else {
        panic!("expected a wait");
    };
    rules.change(BUDS, connected(false));
    let Some(Step::Wait(second)) = rules.change(BUDS, connected(true)) else {
        panic!("expected a wait");
    };
    assert_ne!(first, second);
    assert_eq!(rules.wait_ended(BUDS, first), None);
    assert!(rules.wait_ended(BUDS, second).is_some());
}

#[test]
fn non_audio_devices_are_ignored() {
    let mouse = "/org/bluez/hci0/dev_BB";
    let mut rules = BluetoothRules::default();
    rules.add(
        mouse,
        DeviceChange {
            alias: Some("Mouse".into()),
            icon: Some("input-mouse".into()),
            class: Some(0x002580),
            connected: Some(false),
        },
    );
    assert_eq!(rules.change(mouse, connected(true)), None);
    assert_eq!(rules.change(mouse, connected(false)), None);
}

#[test]
fn alias_change_renames_and_repeats_are_ignored() {
    let mut rules = BluetoothRules::default();
    rules.add(BUDS, buds(false));
    rules.battery(BUDS, Some(70));
    rules.change(
        BUDS,
        DeviceChange {
            alias: Some("My Buds".into()),
            ..DeviceChange::default()
        },
    );
    assert_eq!(
        rules.change(BUDS, connected(true)),
        Some(Step::Alert(Alert::device(
            Kind::BluetoothConnected,
            "My Buds",
            70
        )))
    );
    assert_eq!(rules.change(BUDS, connected(true)), None);
}

#[test]
fn unknown_and_removed_devices_are_silent() {
    let mut rules = BluetoothRules::default();
    assert_eq!(rules.change(BUDS, buds(true)), None);
    rules.remove(BUDS);
    assert_eq!(rules.change(BUDS, connected(false)), None);
}

#[test]
fn kinds_on_the_bus() {
    let all = [
        (Kind::BluetoothConnected, "bluetooth-connected"),
        (Kind::BluetoothDisconnected, "bluetooth-disconnected"),
        (Kind::ChargerPlugged, "charger-plugged"),
        (Kind::ChargerUnplugged, "charger-unplugged"),
        (Kind::BatteryLow, "battery-low"),
        (Kind::BatteryCritical, "battery-critical"),
        (Kind::BatteryFull, "battery-full"),
    ];
    for (kind, name) in all {
        assert_eq!(kind.as_str(), name);
    }
}

#[test]
fn windows_power_status_becomes_a_sample() {
    // On AC, charging at 64 %.
    let sample = windows_battery(1, 8, 64);
    assert!(sample.present && !sample.on_battery && !sample.full);
    assert_eq!(sample.percentage, 64.0);
    // On battery.
    assert!(windows_battery(0, 1, 80).on_battery);
    // Full once on AC at 100 %, whether or not Windows still says charging.
    assert!(windows_battery(1, 1, 100).full);
    assert!(windows_battery(1, 9, 100).full);
    assert!(!windows_battery(0, 1, 100).full);
    // No system battery, or one Windows does not know.
    assert!(!windows_battery(1, 128, 255).present);
    assert!(!windows_battery(255, 255, 255).present);
    assert!(!windows_battery(1, 1, 255).present);
}

#[test]
fn windows_class_of_device_is_audio_for_audio_video() {
    // Headphones: major class 4 (audio/video), minor 6.
    assert!(is_audio("", cod_class(4, 6)));
    // A phone (2) or a keyboard (5) is not.
    assert!(!is_audio("", cod_class(2, 3)));
    assert!(!is_audio("", cod_class(5, 16)));
}

#[test]
fn windows_connect_alert_goes_at_once_without_battery() {
    // Windows gives no Bluetooth battery: the wait ends as soon as it starts.
    let mut rules = BluetoothRules::default();
    rules.add(
        "aep",
        DeviceChange {
            alias: Some("Buds".into()),
            class: Some(cod_class(4, 6)),
            connected: Some(false),
            ..DeviceChange::default()
        },
    );
    let Some(Step::Wait(wait)) = rules.change("aep", connected(true)) else {
        panic!("expected a wait");
    };
    assert_eq!(
        rules.wait_ended("aep", wait),
        Some(Alert::device(Kind::BluetoothConnected, "Buds", -1))
    );
}
