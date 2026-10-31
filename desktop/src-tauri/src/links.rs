//! The links the page may ask Windows to open: Windows' own panels that
//! home's tiles stand in for, and web pages. Pure, so it is tested on every
//! system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

/// Windows' notification centre and its snipping overlay.
pub const NOTIFICATIONS: &str = "ms-actioncenter:";
pub const SCREENSHOT: &str = "ms-screenclip:";

/// Whether the page may open `uri`: one of Windows' panels above, or a web
/// page; never a file or a program.
pub fn may_open(uri: &str) -> bool {
    uri == NOTIFICATIONS || uri == SCREENSHOT || uri.starts_with("https://")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_windows_panels_and_web_pages_only() {
        assert!(may_open("ms-actioncenter:"));
        assert!(may_open("ms-screenclip:"));
        assert!(may_open("https://github.com/MasRama/nokta/releases"));
        assert!(!may_open("http://example.com"));
        assert!(!may_open("C:\\Windows\\System32\\cmd.exe"));
        assert!(!may_open("file:///C:/x.exe"));
        assert!(!may_open("ms-settings:"));
    }
}
