use super::launcher::Action;
use super::model::Update;
use super::packagekit::{detail, outcome, progress, skipped, title, PackageKitState, Props};

const UPDATE_PACKAGES: u32 = 22;
const REFRESH_CACHE: u32 = 13;
const DOWNLOAD: u32 = 8;
const INSTALL: u32 = 9;
const SIMULATE: u64 = 1 << 2;
const ONLY_DOWNLOAD: u64 = 1 << 3;
const ONLY_TRUSTED: u64 = 1 << 1;

fn props(role: u32, status: u32, percentage: u32, flags: u64) -> Props {
    Props {
        role: Some(role),
        status: Some(status),
        percentage: Some(percentage),
        flags: Some(flags),
    }
}

fn updates(detail: &str, progress: f64) -> Action {
    Action::Set(
        "packagekit:/1_abc".into(),
        Update {
            title: "Installing updates".into(),
            detail: detail.into(),
            icon: "software-update-available-symbolic".into(),
            progress,
        },
    )
}

fn end(success: bool, message: &str) -> Action {
    Action::End("packagekit:/1_abc".into(), success, message.into())
}

#[test]
fn only_installs_removals_and_updates_have_a_title() {
    assert_eq!(title(10), Some("Installing software"));
    assert_eq!(title(11), Some("Installing software"));
    assert_eq!(title(14), Some("Removing software"));
    assert_eq!(title(22), Some("Installing updates"));
    assert_eq!(title(33), Some("Upgrading the system"));
    assert_eq!(title(0), None);
    assert_eq!(title(REFRESH_CACHE), None);
}

#[test]
fn the_detail_says_what_the_transaction_is_doing() {
    assert_eq!(detail(DOWNLOAD), "Downloading");
    assert_eq!(detail(21), "Downloading");
    assert_eq!(detail(INSTALL), "Installing");
    assert_eq!(detail(10), "Updating");
    assert_eq!(detail(6), "Removing");
    assert_eq!(detail(30), "Waiting");
    assert_eq!(detail(31), "Waiting for authorization");
    assert_eq!(detail(2), "Preparing");
    assert_eq!(detail(99), "Preparing");
}

#[test]
fn percentage_101_is_unknown_progress() {
    assert_eq!(progress(101), -1.0);
    assert_eq!(progress(0), 0.0);
    assert_eq!(progress(42), 0.42);
    assert_eq!(progress(100), 1.0);
}

#[test]
fn simulated_and_download_only_transactions_are_skipped() {
    assert!(skipped(SIMULATE));
    assert!(skipped(ONLY_DOWNLOAD | ONLY_TRUSTED));
    assert!(!skipped(ONLY_TRUSTED));
    assert!(!skipped(0));
}

#[test]
fn only_a_successful_exit_is_a_success() {
    assert_eq!(outcome(1), (true, "Done"));
    assert_eq!(outcome(2), (false, "Failed"));
    assert_eq!(outcome(3), (false, "Cancelled"));
    assert_eq!(outcome(6), (false, "Cancelled"));
    assert_eq!(outcome(9), (false, "Cancelled"));
    assert_eq!(outcome(11), (false, "Failed"));
}

#[test]
fn an_update_shows_with_its_status_and_progress() {
    let mut s = PackageKitState::default();
    assert_eq!(
        s.changed("/1_abc", props(UPDATE_PACKAGES, DOWNLOAD, 30, 0)),
        vec![updates("Downloading", 0.3)]
    );
    let step = Props {
        status: Some(INSTALL),
        percentage: Some(101),
        ..Props::default()
    };
    assert_eq!(s.changed("/1_abc", step), vec![updates("Installing", -1.0)]);
}

#[test]
fn nothing_is_sent_when_nothing_shown_changed() {
    let mut s = PackageKitState::default();
    s.changed("/1_abc", props(UPDATE_PACKAGES, DOWNLOAD, 30, 0));
    let same = Props {
        status: Some(DOWNLOAD),
        ..Props::default()
    };
    assert_eq!(s.changed("/1_abc", same), vec![]);
}

#[test]
fn a_transaction_waits_for_its_role_and_flags() {
    let mut s = PackageKitState::default();
    let role = Props {
        role: Some(UPDATE_PACKAGES),
        ..Props::default()
    };
    assert_eq!(s.changed("/1_abc", role), vec![]);
    let flags = Props {
        flags: Some(ONLY_TRUSTED),
        ..Props::default()
    };
    assert_eq!(s.changed("/1_abc", flags), vec![updates("Preparing", -1.0)]);
}

#[test]
fn skipped_and_untitled_transactions_never_show() {
    let mut s = PackageKitState::default();
    assert_eq!(
        s.changed("/1_abc", props(UPDATE_PACKAGES, DOWNLOAD, 30, SIMULATE)),
        vec![]
    );
    assert_eq!(
        s.changed("/2_def", props(REFRESH_CACHE, DOWNLOAD, 30, 0)),
        vec![]
    );
    assert_eq!(s.finished("/1_abc", 1), vec![]);
    assert_eq!(s.finished("/2_def", 1), vec![]);
}

#[test]
fn finished_ends_the_activity_with_its_exit() {
    let mut s = PackageKitState::default();
    s.changed("/1_abc", props(UPDATE_PACKAGES, DOWNLOAD, 30, 0));
    assert_eq!(s.finished("/1_abc", 1), vec![end(true, "Done")]);

    let mut s = PackageKitState::default();
    s.changed("/1_abc", props(UPDATE_PACKAGES, DOWNLOAD, 30, 0));
    assert_eq!(s.finished("/1_abc", 3), vec![end(false, "Cancelled")]);
}

#[test]
fn a_transaction_gone_from_the_list_ends_as_stopped() {
    let mut s = PackageKitState::default();
    s.changed("/1_abc", props(UPDATE_PACKAGES, DOWNLOAD, 30, 0));
    s.changed("/2_def", props(REFRESH_CACHE, DOWNLOAD, 30, 0));
    assert_eq!(
        s.listed(&["/3_ghi".to_owned()]),
        vec![end(false, "Stopped")]
    );
    assert!(!s.knows("/1_abc"));
    assert!(!s.knows("/2_def"));
}

#[test]
fn packagekit_leaving_stops_what_it_was_doing() {
    let mut s = PackageKitState::default();
    s.changed("/1_abc", props(UPDATE_PACKAGES, DOWNLOAD, 30, 0));
    assert_eq!(s.gone(), vec![end(false, "Stopped")]);
    assert!(!s.knows("/1_abc"));
}

#[test]
fn a_finished_transaction_never_shows_again() {
    let mut s = PackageKitState::default();
    s.changed("/1_abc", props(UPDATE_PACKAGES, DOWNLOAD, 30, 0));
    s.finished("/1_abc", 1);
    assert_eq!(
        s.changed("/1_abc", props(UPDATE_PACKAGES, 18, 100, 0)),
        vec![]
    );
    assert!(s.knows("/1_abc"));
    assert_eq!(s.listed(&[]), vec![]);
    assert!(!s.knows("/1_abc"));
}
