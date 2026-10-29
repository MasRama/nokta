use super::desktop::{parse_entry, App};
use super::launcher::{Action, LauncherState, Report};
use super::model::Update;

const MS: i64 = 1_000;
const FIREFOX: &str = "application://firefox_firefox.desktop";

fn firefox(_id: &str) -> App {
    App {
        name: "Firefox".into(),
        icon: "firefox".into(),
    }
}

fn shown(progress: f64) -> Report {
    Report {
        progress: Some(progress),
        visible: Some(true),
    }
}

fn hidden() -> Report {
    Report {
        progress: None,
        visible: Some(false),
    }
}

fn set(progress: f64) -> Action {
    Action::Set(
        "app:firefox_firefox.desktop".into(),
        Update {
            title: "Firefox".into(),
            detail: "Downloading".into(),
            icon: "firefox".into(),
            progress,
        },
    )
}

#[test]
fn progress_shows_once_it_has_been_visible_for_a_second_and_a_half() {
    let mut s = LauncherState::default();
    assert_eq!(s.update(":1.5", FIREFOX, shown(0.1), firefox, 0), vec![]);
    assert_eq!(s.next_deadline(), Some(1_500 * MS));
    assert_eq!(s.tick(1_499 * MS), vec![]);
    assert_eq!(s.tick(1_500 * MS), vec![set(0.1)]);
}

#[test]
fn quick_progress_never_shows() {
    let mut s = LauncherState::default();
    s.update(":1.5", FIREFOX, shown(0.5), firefox, 0);
    assert_eq!(
        s.update(":1.5", FIREFOX, hidden(), firefox, 900 * MS),
        vec![]
    );
    assert_eq!(s.next_deadline(), None);
    assert_eq!(s.tick(2_000 * MS), vec![]);
}

#[test]
fn hidden_progress_never_shows() {
    let mut s = LauncherState::default();
    let report = Report {
        progress: Some(0.3),
        visible: Some(false),
    };
    s.update(":1.5", FIREFOX, report, firefox, 0);
    assert_eq!(s.tick(5_000 * MS), vec![]);
    // Visible only, with the progress it had before.
    let visible = Report {
        progress: None,
        visible: Some(true),
    };
    s.update(":1.5", FIREFOX, visible, firefox, 6_000 * MS);
    assert_eq!(s.tick(7_500 * MS), vec![set(0.3)]);
}

#[test]
fn updates_pass_at_most_twice_a_second() {
    let mut s = LauncherState::default();
    s.update(":1.5", FIREFOX, shown(0.1), firefox, 0);
    s.tick(1_500 * MS);
    assert_eq!(
        s.update(":1.5", FIREFOX, shown(0.2), firefox, 1_700 * MS),
        vec![]
    );
    assert_eq!(
        s.update(":1.5", FIREFOX, shown(0.3), firefox, 1_800 * MS),
        vec![]
    );
    assert_eq!(s.next_deadline(), Some(2_000 * MS));
    assert_eq!(s.tick(2_000 * MS), vec![set(0.3)]);
    assert_eq!(s.next_deadline(), None);
    assert_eq!(
        s.update(":1.5", FIREFOX, shown(0.4), firefox, 2_600 * MS),
        vec![set(0.4)]
    );
}

#[test]
fn hidden_again_ends_as_done() {
    let mut s = LauncherState::default();
    s.update(":1.5", FIREFOX, shown(0.9), firefox, 0);
    s.tick(1_500 * MS);
    assert_eq!(
        s.update(":1.5", FIREFOX, hidden(), firefox, 3_000 * MS),
        vec![Action::End(
            "app:firefox_firefox.desktop".into(),
            true,
            "Done".into()
        )]
    );
    // The next download starts over.
    assert_eq!(
        s.update(":1.5", FIREFOX, shown(0.1), firefox, 4_000 * MS),
        vec![]
    );
}

#[test]
fn the_app_leaving_the_bus_ends_as_stopped() {
    let mut s = LauncherState::default();
    s.update(":1.5", FIREFOX, shown(0.4), firefox, 0);
    s.tick(1_500 * MS);
    s.update(
        ":1.9",
        "application://org.gnome.Nautilus.desktop",
        shown(0.2),
        firefox,
        0,
    );
    assert_eq!(
        s.sender_gone(":1.5"),
        vec![Action::End(
            "app:firefox_firefox.desktop".into(),
            false,
            "Stopped".into()
        )]
    );
    // One never shown goes without a word.
    assert_eq!(s.sender_gone(":1.9"), vec![]);
    assert_eq!(s.next_deadline(), None);
}

#[test]
fn the_detail_says_what_kind_of_app_it_is() {
    let detail = |uri: &str| {
        let mut s = LauncherState::default();
        s.update(":1.5", uri, shown(0.5), firefox, 0);
        match s.tick(1_500 * MS).pop() {
            Some(Action::Set(_, update)) => update.detail,
            other => panic!("{other:?}"),
        }
    };
    assert_eq!(detail("application://firefox.desktop"), "Downloading");
    assert_eq!(detail("application://google-chrome.desktop"), "Downloading");
    assert_eq!(
        detail("application://com.brave.Browser.desktop"),
        "Downloading"
    );
    assert_eq!(
        detail("application://org.gnome.Nautilus.desktop"),
        "Working on files"
    );
    assert_eq!(
        detail("application://org.gnome.Builder.desktop"),
        "In progress"
    );
}

#[test]
fn a_report_without_an_app_uri_is_left_out() {
    let mut s = LauncherState::default();
    assert_eq!(
        s.update(":1.5", "firefox.desktop", shown(0.5), firefox, 0),
        vec![]
    );
    assert_eq!(s.next_deadline(), None);
}

#[test]
fn a_desktop_entry_gives_its_name_and_icon_name() {
    let text = "[Desktop Entry]\nType=Application\nName[de]=Feuerfuchs\nName=Firefox\nIcon=firefox\n\n[Desktop Action new-window]\nName=New Window\nIcon=other\n";
    assert_eq!(
        parse_entry(text),
        Some(("Firefox".into(), "firefox".into()))
    );
    // An icon given as a file is no icon name.
    let text = "[Desktop Entry]\nName=Tool\nIcon=/opt/tool/icon.png\n";
    assert_eq!(parse_entry(text), Some(("Tool".into(), String::new())));
    assert_eq!(parse_entry("[Desktop Entry]\nIcon=x\n"), None);
}

#[cfg(unix)]
mod files {
    use super::*;
    use crate::features::activities::desktop::app_for;

    #[test]
    fn the_app_is_found_in_the_first_data_dir_that_has_it() {
        let root = std::env::temp_dir().join(format!("nokta-desktop-{}", std::process::id()));
        let (first, second) = (root.join("a"), root.join("b"));
        for dir in [&first, &second] {
            std::fs::create_dir_all(dir.join("applications")).unwrap();
        }
        std::fs::write(
            second.join("applications/files.desktop"),
            "[Desktop Entry]\nName=Files\nIcon=org.gnome.Nautilus\n",
        )
        .unwrap();
        let dirs = [first.clone(), second.clone()];
        assert_eq!(
            app_for("files.desktop", &dirs),
            App {
                name: "Files".into(),
                icon: "org.gnome.Nautilus".into()
            }
        );
        // Without an entry the id is the title.
        assert_eq!(
            app_for("mystery.desktop", &dirs),
            App {
                name: "mystery".into(),
                icon: String::new()
            }
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
