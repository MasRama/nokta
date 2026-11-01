//! Reaches Nokta: noktad on the session bus on Linux, the app's named pipe
//! on Windows. Both have the same methods.

use std::fmt;

#[cfg(target_os = "linux")]
mod bus;
#[cfg(windows)]
mod pipe;

#[cfg(target_os = "linux")]
pub use bus::{Client, NAME};
#[cfg(windows)]
pub use pipe::{Client, NAME};

#[derive(Debug)]
pub enum CallError {
    /// Nokta is not there, or the way to it broke.
    Unreachable(String),
    /// Nokta got the call and said no, in its own words.
    Refused(String),
}

impl fmt::Display for CallError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CallError::Unreachable(err) => write!(f, "cannot reach {NAME}: {err}"),
            CallError::Refused(message) => f.write_str(message),
        }
    }
}
