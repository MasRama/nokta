//! The open shortcut as Windows registers it, from the config's GNOME key
//! syntax (`<Super><Alt>n`). Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

/// Windows' `MOD_ALT`.
pub const ALT: u32 = 0x1;
/// Windows' `MOD_CONTROL`.
pub const CONTROL: u32 = 0x2;
/// Windows' `MOD_SHIFT`.
pub const SHIFT: u32 = 0x4;
/// Windows' `MOD_WIN`.
pub const WIN: u32 = 0x8;

/// A key with its modifiers, as `RegisterHotKey` takes them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hotkey {
    /// `MOD_*` bits.
    pub modifiers: u32,
    /// The virtual-key code.
    pub key: u32,
}

/// The hotkey for `accelerator`; none when it is empty or names a modifier
/// or a key Windows has no code for.
pub fn parse(accelerator: &str) -> Option<Hotkey> {
    let mut modifiers = 0;
    let mut rest = accelerator.trim();
    while let Some(after) = rest.strip_prefix('<') {
        let (name, tail) = after.split_once('>')?;
        modifiers |= modifier(name)?;
        rest = tail;
    }
    Some(Hotkey {
        modifiers,
        key: key(rest)?,
    })
}

fn modifier(name: &str) -> Option<u32> {
    match name.to_ascii_lowercase().as_str() {
        "super" | "meta" | "hyper" => Some(WIN),
        "alt" | "mod1" => Some(ALT),
        "control" | "ctrl" | "primary" => Some(CONTROL),
        "shift" => Some(SHIFT),
        _ => None,
    }
}

/// The virtual-key code of a GNOME key name.
fn key(name: &str) -> Option<u32> {
    let mut chars = name.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        // Letters and digits are their own codes, the letters in capitals.
        if c.is_ascii_alphanumeric() {
            return Some(u32::from(c.to_ascii_uppercase()));
        }
    }
    if let Some(n) = name
        .strip_prefix(['F', 'f'])
        .and_then(|n| n.parse::<u32>().ok())
    {
        return (1..=24).contains(&n).then_some(0x70 + n - 1);
    }
    let code = match name.to_ascii_lowercase().as_str() {
        "space" => 0x20,
        "return" | "kp_enter" => 0x0D,
        "tab" => 0x09,
        "escape" => 0x1B,
        "backspace" => 0x08,
        "insert" => 0x2D,
        "delete" => 0x2E,
        "home" => 0x24,
        "end" => 0x23,
        "page_up" | "prior" => 0x21,
        "page_down" | "next" => 0x22,
        "left" => 0x25,
        "up" => 0x26,
        "right" => 0x27,
        "down" => 0x28,
        "print" => 0x2C,
        "pause" => 0x13,
        "semicolon" => 0xBA,
        "equal" => 0xBB,
        "comma" => 0xBC,
        "minus" => 0xBD,
        "period" => 0xBE,
        "slash" => 0xBF,
        "grave" => 0xC0,
        "bracketleft" => 0xDB,
        "backslash" => 0xDC,
        "bracketright" => 0xDD,
        "apostrophe" => 0xDE,
        _ => return None,
    };
    Some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_default_shortcut() {
        assert_eq!(
            parse("<Super><Alt>n"),
            Some(Hotkey {
                modifiers: WIN | ALT,
                key: 0x4E
            })
        );
    }

    #[test]
    fn reads_gnome_names_for_control_and_keys() {
        assert_eq!(
            parse("<Primary><Shift>space"),
            Some(Hotkey {
                modifiers: CONTROL | SHIFT,
                key: 0x20
            })
        );
        assert_eq!(parse("<Ctrl>F12").map(|h| h.key), Some(0x7B));
        assert_eq!(parse("<Super>7").map(|h| h.key), Some(0x37));
        assert_eq!(parse("<Super>comma").map(|h| h.key), Some(0xBC));
    }

    #[test]
    fn has_none_for_an_empty_or_unknown_shortcut() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("<Super>"), None);
        assert_eq!(parse("<Fn>n"), None);
        assert_eq!(parse("<Super>XF86AudioPlay"), None);
        assert_eq!(parse("<Super>F25"), None);
        assert_eq!(parse("<Super"), None);
    }
}
