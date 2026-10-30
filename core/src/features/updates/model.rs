//! Versions, release file names and checksums. Pure.

use sha2::{Digest, Sha256};

/// The first check, this long after noktad starts.
pub const FIRST_CHECK_US: i64 = 30_000_000;
/// Then one check a day.
pub const DAY_US: i64 = 24 * 3600 * 1_000_000;

/// `0.12.0` or `v0.12.0` as numbers. Pre-releases (`1.0.0-rc.1`), build
/// metadata and anything else are `None`.
fn version(text: &str) -> Option<[u64; 3]> {
    let text = text.strip_prefix('v').unwrap_or(text);
    let mut parts = text.split('.');
    let mut numbers = [0; 3];
    for number in &mut numbers {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *number = part.parse().ok()?;
    }
    parts.next().is_none().then_some(numbers)
}

/// The release `tag`'s version when it is newer than `current`.
pub fn newer(current: &str, tag: &str) -> Option<String> {
    let release = version(tag)?;
    let current = version(current)?;
    (release > current).then(|| format!("{}.{}.{}", release[0], release[1], release[2]))
}

/// The daemon archive a release publishes for this version.
pub fn tarball_name(version: &str) -> String {
    format!("noktad-{version}-x86_64-linux.tar.gz")
}

/// The SHA-256, in lowercase hex, that `sha256sum` output lists for `file`.
pub fn sum_for(sums: &str, file: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (sum, name) = line.split_once(' ')?;
        // Text mode has a second space before the name, binary mode a `*`.
        let name = name.strip_prefix([' ', '*']).unwrap_or(name);
        let is_sha256 = sum.len() == 64 && sum.bytes().all(|b| b.is_ascii_hexdigit());
        (name == file && is_sha256).then(|| sum.to_ascii_lowercase())
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SumError {
    #[error("SHA256SUMS does not list it")]
    NotListed,
    #[error("its SHA-256 is not the one in SHA256SUMS")]
    Mismatch,
}

/// Whether `data` is the `file` that `sums` lists.
pub fn check_sum(data: &[u8], sums: &str, file: &str) -> Result<(), SumError> {
    let expected = sum_for(sums, file).ok_or(SumError::NotListed)?;
    if hex::encode(Sha256::digest(data)) == expected {
        Ok(())
    } else {
        Err(SumError::Mismatch)
    }
}
