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
