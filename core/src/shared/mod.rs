//! Business-neutral infrastructure shared by every feature.

pub mod clock;
#[cfg(target_os = "linux")]
pub mod dbus;
pub mod hash;
pub mod http;
pub mod paths;
