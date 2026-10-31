//! What the page sees of the core: each interface's properties under their
//! names in `contracts/*.xml`, as JSON, so the page reads them the way the
//! extension reads D-Bus. The contract test holds both to the XML.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

pub mod devices;
pub mod lyrics;
pub mod media;
pub mod nokta;
pub mod osd;
pub mod privacy;
pub mod settings;

#[cfg(test)]
mod contract_tests;

/// An interface's properties, by name.
pub type Props = serde_json::Map<String, serde_json::Value>;
