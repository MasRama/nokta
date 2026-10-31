//! What the page sees of the core: each interface's properties under their
//! names in `contracts/*.xml`, as JSON, so the page reads them the way the
//! extension reads D-Bus. The contract test holds both to the XML.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

pub mod activities;
pub mod clipboard;
pub mod devices;
pub mod downloads;
pub mod lyrics;
pub mod media;
pub mod nokta;
pub mod osd;
pub mod privacy;
pub mod settings;
pub mod shelf;
pub mod system;
pub mod timer;
pub mod toggles;
pub mod updates;
pub mod weather;

#[cfg(test)]
mod contract_tests;

/// An interface's properties, by name.
pub type Props = serde_json::Map<String, serde_json::Value>;
