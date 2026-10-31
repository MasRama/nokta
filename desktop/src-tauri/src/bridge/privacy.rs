//! `Privacy1`: the camera and the microphone in use, for the privacy dots
//! and the call. The page's own interface: on Linux the extension reads
//! GNOME's indicators instead.

use serde_json::json;

use super::Props;
use crate::privacy::{InUse, PrivacyState};

pub const INTERFACE: &str = "Privacy1";

/// The properties: whether each device is in use and by which app, since
/// when the microphone is on (wall clock, µs; 0 while off) and its mute.
pub fn props(state: &PrivacyState) -> Props {
    let app = |device: &Option<InUse>| device.as_ref().map_or_else(String::new, |d| d.app.clone());
    let mut props = Props::new();
    props.insert("Camera".into(), json!(state.camera.is_some()));
    props.insert("CameraApp".into(), json!(app(&state.camera)));
    props.insert("Microphone".into(), json!(state.microphone.is_some()));
    props.insert("MicrophoneApp".into(), json!(app(&state.microphone)));
    props.insert(
        "MicrophoneSinceUs".into(),
        json!(state.microphone.as_ref().map_or(0, |m| m.since_us)),
    );
    props.insert("MicrophoneMuted".into(), json!(state.muted));
    props
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_what_is_in_use_and_by_whom() {
        let state = PrivacyState {
            camera: None,
            microphone: Some(InUse {
                app: "Zoom".into(),
                since_us: 42,
            }),
            muted: true,
        };
        let props = props(&state);
        assert_eq!(props["Camera"], json!(false));
        assert_eq!(props["CameraApp"], json!(""));
        assert_eq!(props["Microphone"], json!(true));
        assert_eq!(props["MicrophoneApp"], json!("Zoom"));
        assert_eq!(props["MicrophoneSinceUs"], json!(42));
        assert_eq!(props["MicrophoneMuted"], json!(true));
        assert_eq!(
            super::props(&PrivacyState::default())["MicrophoneSinceUs"],
            json!(0)
        );
    }
}
