//! `Toggles1`: home's quick toggles Windows has. The page's own interface:
//! on Linux the extension reads GNOME's settings instead. Windows has no
//! public Do Not Disturb or Night Light, so home hides those two.

use serde_json::json;

use super::Props;

pub const INTERFACE: &str = "Toggles1";

/// The toggles' states.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TogglesState {
    /// Windows' apps and system use the dark style.
    pub dark_style: bool,
    /// The screen and the system stay awake.
    pub caffeine: bool,
}

pub fn props(state: &TogglesState) -> Props {
    let mut props = Props::new();
    props.insert("DarkStyle".into(), json!(state.dark_style));
    props.insert("Caffeine".into(), json!(state.caffeine));
    props
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_each_toggle() {
        let props = props(&TogglesState {
            dark_style: true,
            caffeine: false,
        });
        assert_eq!(props["DarkStyle"], json!(true));
        assert_eq!(props["Caffeine"], json!(false));
    }
}
