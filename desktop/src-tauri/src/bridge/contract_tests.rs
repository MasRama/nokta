//! The bridge publishes exactly the properties of `contracts/*.xml`, each
//! as the JSON kind of its D-Bus type.

use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;
use serde_json::Value;

use super::Props;

/// The (name, type) of each property of `io.nokta.<interface>`.
fn properties(interface: &str) -> Vec<(String, String)> {
    let file = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../contracts")
        .join(format!("io.nokta.{interface}.xml"));
    let xml = std::fs::read_to_string(&file).unwrap();
    let mut reader = Reader::from_str(&xml);
    let mut out = Vec::new();
    loop {
        match reader.read_event().unwrap() {
            Event::Start(e) | Event::Empty(e) if e.name().as_ref() == "property" => {
                let attr = |key: &str| {
                    e.attributes()
                        .flatten()
                        .find(|a| a.key.as_ref() == key)
                        .map(|a| {
                            a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                                .unwrap()
                                .into_owned()
                        })
                        .unwrap_or_default()
                };
                out.push((attr("name"), attr("type")));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// The types of the arguments of `io.nokta.<interface>`'s `signal`.
fn signal_args(interface: &str, signal: &str) -> Vec<String> {
    let file = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../contracts")
        .join(format!("io.nokta.{interface}.xml"));
    let xml = std::fs::read_to_string(&file).unwrap();
    let mut reader = Reader::from_str(&xml);
    let mut inside = false;
    let mut out = Vec::new();
    loop {
        match reader.read_event().unwrap() {
            Event::Start(e) | Event::Empty(e) => {
                let attr = |key: &str| {
                    e.attributes()
                        .flatten()
                        .find(|a| a.key.as_ref() == key)
                        .map(|a| {
                            a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                                .unwrap()
                                .into_owned()
                        })
                        .unwrap_or_default()
                };
                match e.name().as_ref() {
                    "signal" => inside = attr("name") == signal,
                    "arg" if inside => out.push(attr("type")),
                    _ => {}
                }
            }
            Event::End(e) if e.name().as_ref() == "signal" => inside = false,
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// Whether `value` is how JSON carries a D-Bus value of type `signature`.
fn fits(signature: &str, value: &Value) -> bool {
    match signature.as_bytes().first() {
        Some(b'b') => value.is_boolean(),
        Some(b's' | b'o') => value.is_string(),
        Some(b'y' | b'n' | b'q' | b'i' | b'u' | b'x' | b't' | b'd') => value.is_number(),
        Some(b'a') if signature.starts_with("a{") => value.is_object(),
        Some(b'a' | b'(') => value.is_array(),
        _ => false,
    }
}

fn check(interface: &str, props: &Props) {
    let expected = properties(interface);
    assert!(!expected.is_empty(), "no properties read for {interface}");
    for (name, signature) in &expected {
        let value = props
            .get(name)
            .unwrap_or_else(|| panic!("{interface}.{name} is missing"));
        assert!(
            fits(signature, value),
            "{interface}.{name} is {value}, not {signature}"
        );
    }
    for name in props.keys() {
        assert!(
            expected.iter().any(|(known, _)| known == name),
            "{interface}.{name} is not in the contract"
        );
    }
}

#[test]
fn nokta() {
    check(super::nokta::INTERFACE, &super::nokta::props());
}

#[test]
fn settings() {
    use nokta_core::features::settings::picture::Prepared;
    use nokta_core::features::settings::Config;
    let props = super::settings::props(&Config::default(), &Prepared::default());
    check(super::settings::INTERFACE, &props);
}

#[test]
fn media() {
    use nokta_core::features::media::MediaState;
    check(
        super::media::INTERFACE,
        &super::media::props(&MediaState::default(), 0, 0),
    );
}

#[test]
fn lyrics() {
    use nokta_core::features::lyrics::LyricsState;
    check(
        super::lyrics::INTERFACE,
        &super::lyrics::props(&LyricsState::default()),
    );
}

#[test]
fn devices_alert() {
    use nokta_core::features::devices::rules::{Alert, Kind};
    let types = signal_args(super::devices::INTERFACE, super::devices::ALERT);
    let args = super::devices::alert_args(&Alert::device(Kind::BluetoothConnected, "Buds", 80));
    assert_eq!(types.len(), args.len(), "{types:?} and {args:?}");
    for (signature, value) in types.iter().zip(&args) {
        assert!(fits(signature, value), "{value} is not {signature}");
    }
}

#[test]
fn weather() {
    use nokta_core::features::weather::WeatherState;
    check(
        super::weather::INTERFACE,
        &super::weather::props(&WeatherState::default()),
    );
}

#[test]
fn timer() {
    use nokta_core::features::timer::clocks::{ClockView, Kind};
    use nokta_core::features::timer::logic::Snapshot;
    use nokta_core::features::timer::service::ClocksSnapshot;
    let mut props = super::timer::props(&Snapshot::default(), 1, 2);
    let clocks = ClocksSnapshot {
        clocks: vec![ClockView {
            id: "c1".into(),
            kind: Kind::Stopwatch,
            label: String::new(),
            running: true,
            duration_us: 0,
            value_us: 5,
            alarm_unix_us: 0,
        }],
        timestamp_us: 1,
    };
    props.extend(super::timer::clock_props(&clocks, 1, 2));
    check(super::timer::INTERFACE, &props);
}

#[test]
fn timer_signals() {
    use nokta_core::features::timer::clocks::{Done, Kind};
    use nokta_core::features::timer::logic::Phase;
    let done = Done {
        id: "c1".into(),
        kind: Kind::Alarm,
        label: "Wake up".into(),
    };
    for (signal, args) in [
        (
            super::timer::FINISHED,
            super::timer::finished_args(&Phase::Focus),
        ),
        (
            super::timer::CLOCK_DONE,
            super::timer::clock_done_args(&done),
        ),
    ] {
        let types = signal_args(super::timer::INTERFACE, signal);
        assert_eq!(types.len(), args.len(), "{signal}: {types:?} and {args:?}");
        for (signature, value) in types.iter().zip(&args) {
            assert!(fits(signature, value), "{value} is not {signature}");
        }
    }
}

#[test]
fn activities() {
    use nokta_core::features::activities::model::{Activities, Update};
    let mut list = Activities::default();
    let update = Update {
        title: "Build".into(),
        detail: String::new(),
        icon: String::new(),
        progress: -1.0,
    };
    list.set("build", update, 1).unwrap();
    check(
        super::activities::INTERFACE,
        &super::activities::props(list.list(), 1, 2),
    );
}

#[test]
fn activities_ended() {
    use nokta_core::features::activities::model::Ended;
    let ended = Ended {
        id: "build".into(),
        title: "Build".into(),
        success: true,
        message: String::new(),
        elapsed_us: 5,
    };
    let types = signal_args(super::activities::INTERFACE, super::activities::ENDED);
    let args = super::activities::ended_args(&ended);
    assert_eq!(types.len(), args.len(), "{types:?} and {args:?}");
    for (signature, value) in types.iter().zip(&args) {
        assert!(fits(signature, value), "{value} is not {signature}");
    }
}

#[test]
fn updates() {
    use nokta_core::features::updates::UpdateState;
    check(
        super::updates::INTERFACE,
        &super::updates::props(&UpdateState::default()),
    );
}
