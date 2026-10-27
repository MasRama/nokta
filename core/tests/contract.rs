//! The daemon's introspection must match the published contracts exactly.

mod support;

use std::collections::BTreeSet;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;
use support::bus::TestBus;
use support::daemon::{Daemon, NAME};

/// (kind, name, signature, access, emits-changed-signal)
type Member = (String, String, String, String, String);

fn attr(e: &quick_xml::events::BytesStart<'_>, key: &str) -> String {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key)
        .map(|a| {
            a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .unwrap()
                .into_owned()
        })
        .unwrap_or_default()
}

/// Members of every `io.nokta.*` interface in an introspection document.
fn members(xml: &str) -> BTreeSet<(String, Member)> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut out = BTreeSet::new();
    let mut interface: Option<String> = None;
    let mut current: Option<Member> = None;
    loop {
        let event = reader.read_event().unwrap();
        let (start, empty) = match &event {
            Event::Start(e) => (Some(e.clone()), false),
            Event::Empty(e) => (Some(e.clone()), true),
            Event::End(e) => {
                match e.name().as_ref() {
                    "interface" => interface = None,
                    "property" | "method" | "signal" => {
                        if let (Some(i), Some(m)) = (&interface, current.take()) {
                            out.insert((i.clone(), m));
                        }
                    }
                    _ => {}
                }
                continue;
            }
            Event::Eof => break,
            _ => continue,
        };
        let e = start.unwrap();
        match e.name().as_ref() {
            "interface" => {
                let name = attr(&e, "name");
                interface = name.starts_with("io.nokta.").then_some(name);
            }
            kind @ ("property" | "method" | "signal") => {
                let kind = kind.to_owned();
                let member = (
                    kind,
                    attr(&e, "name"),
                    attr(&e, "type"),
                    attr(&e, "access"),
                    String::new(),
                );
                if empty {
                    if let Some(i) = &interface {
                        let mut m = member;
                        if m.0 == "property" {
                            m.4 = "true".into();
                        }
                        out.insert((i.clone(), m));
                    }
                } else {
                    current = Some(member);
                    if current.as_ref().unwrap().0 == "property" {
                        current.as_mut().unwrap().4 = "true".into();
                    }
                }
            }
            "arg" => {
                if let Some(m) = current.as_mut() {
                    let direction = match attr(&e, "direction").as_str() {
                        "" if m.0 == "signal" => "out".to_owned(),
                        "" => "in".to_owned(),
                        d => d.to_owned(),
                    };
                    m.2.push_str(&format!(
                        "{direction}:{}:{};",
                        attr(&e, "name"),
                        attr(&e, "type")
                    ));
                }
            }
            "annotation"
                if attr(&e, "name") == "org.freedesktop.DBus.Property.EmitsChangedSignal" =>
            {
                if let Some(m) = current.as_mut() {
                    m.4 = attr(&e, "value");
                }
            }
            _ => {}
        }
    }
    out
}

#[tokio::test]
async fn daemon_matches_contracts() {
    let bus = TestBus::start();
    let _daemon = Daemon::start(&bus, "http://127.0.0.1:9").await;
    let conn = bus.connect().await;
    let contracts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../contracts");
    for (file, path) in [
        ("io.nokta.Nokta1.xml", "/io/nokta/Nokta"),
        ("io.nokta.Media1.xml", "/io/nokta/Media"),
        ("io.nokta.Lyrics1.xml", "/io/nokta/Lyrics"),
        ("io.nokta.Settings1.xml", "/io/nokta/Settings"),
        ("io.nokta.Devices1.xml", "/io/nokta/Devices"),
        ("io.nokta.Timer1.xml", "/io/nokta/Timer"),
    ] {
        let expected = members(&std::fs::read_to_string(contracts.join(file)).unwrap());
        assert!(!expected.is_empty(), "{file} has no io.nokta members");
        let proxy = zbus::fdo::IntrospectableProxy::builder(&conn)
            .destination(NAME)
            .unwrap()
            .path(path)
            .unwrap()
            .build()
            .await
            .unwrap();
        let actual = members(&proxy.introspect().await.unwrap());
        let missing: Vec<_> = expected.difference(&actual).collect();
        let extra: Vec<_> = actual.difference(&expected).collect();
        assert!(
            missing.is_empty() && extra.is_empty(),
            "{path}: missing {missing:#?}\nextra {extra:#?}"
        );
    }
}
