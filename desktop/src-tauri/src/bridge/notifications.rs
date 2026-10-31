//! `Notifications1`: a toast an app showed, read from Windows' notification
//! database, only on Windows (win/notifications.rs). The page shows it as
//! the extension shows a GNOME banner; `Activate` opens what a click on it,
//! or on one of its buttons, opens.

use serde_json::{json, Value};

pub const INTERFACE: &str = "Notifications1";
pub const POSTED: &str = "Posted";

/// A toast for the notch.
#[derive(Clone, Debug, PartialEq)]
pub struct Posted {
    /// Windows' id for it; the same id again is the same toast, updated.
    pub id: i64,
    /// The app's id (its AppUserModelID): toasts from one app stack.
    pub app_id: String,
    /// The app's name.
    pub app: String,
    pub title: String,
    pub body: String,
    /// A picture in the cache: the toast's own logo, else the app's icon.
    pub icon: Option<String>,
    /// The icon is cropped to a circle.
    pub round: bool,
    /// Its buttons' labels.
    pub buttons: Vec<String>,
}

/// `Posted`'s arguments.
pub fn posted_args(toast: &Posted) -> Vec<Value> {
    vec![
        json!(toast.id.to_string()),
        json!(toast.app_id),
        json!(toast.app),
        json!(toast.title),
        json!(toast.body),
        json!(toast.icon.as_deref().unwrap_or_default()),
        json!(toast.round),
        json!(toast.buttons),
    ]
}

/// `Activate(id, button)`'s arguments: the toast, and the button's place in
/// its row, or -1 for the toast itself.
pub fn activation(args: &[Value]) -> Option<(i64, Option<usize>)> {
    let [Value::String(id), button] = args else {
        return None;
    };
    let id = id.parse().ok()?;
    let button = button.as_i64()?;
    Some((id, usize::try_from(button).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_a_toast_and_reads_a_click() {
        let toast = Posted {
            id: 42,
            app_id: "Chrome".into(),
            app: "Google Chrome".into(),
            title: "Rani".into(),
            body: "Sudah sampai".into(),
            icon: None,
            round: true,
            buttons: vec!["Reply".into()],
        };
        assert_eq!(
            posted_args(&toast),
            vec![
                json!("42"),
                json!("Chrome"),
                json!("Google Chrome"),
                json!("Rani"),
                json!("Sudah sampai"),
                json!(""),
                json!(true),
                json!(["Reply"]),
            ]
        );
        assert_eq!(activation(&[json!("42"), json!(-1)]), Some((42, None)));
        assert_eq!(activation(&[json!("42"), json!(1)]), Some((42, Some(1))));
        assert_eq!(activation(&[json!(42), json!(1)]), None);
        assert_eq!(activation(&[json!("x"), json!(1)]), None);
        assert_eq!(activation(&[json!("42")]), None);
    }
}
