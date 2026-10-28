use super::args::{default_title, parse, Cli};

fn args(line: &str) -> Vec<String> {
    line.split_whitespace().map(str::to_owned).collect()
}

#[test]
fn set_with_every_option() {
    assert_eq!(
        parse(&args(
            "activity set backup --title Backup --detail Photos --icon drive-harddisk-symbolic --progress 40"
        )),
        Ok(Cli::Set {
            id: "backup".into(),
            title: "Backup".into(),
            detail: "Photos".into(),
            icon: "drive-harddisk-symbolic".into(),
            progress: 0.4,
        })
    );
}

#[test]
fn set_without_progress_is_unknown_progress() {
    let Ok(Cli::Set {
        progress, detail, ..
    }) = parse(&args("activity set b --title B"))
    else {
        panic!("parsed");
    };
    assert_eq!((progress, detail.as_str()), (-1.0, ""));
}

#[test]
fn set_needs_a_title_and_a_progress_from_0_to_100() {
    assert!(parse(&args("activity set b"))
        .unwrap_err()
        .contains("--title"));
    assert!(parse(&args("activity set b --title B --progress 101")).is_err());
    assert!(parse(&args("activity set b --title B --progress x")).is_err());
    assert!(parse(&args("activity set --title B")).is_err());
}

#[test]
fn end_defaults_to_success() {
    assert_eq!(
        parse(&args("activity end b")),
        Ok(Cli::End {
            id: "b".into(),
            success: true,
            message: String::new(),
        })
    );
    assert_eq!(
        parse(&["activity", "end", "b", "--failed", "--message", "Disk full"].map(String::from)),
        Ok(Cli::End {
            id: "b".into(),
            success: false,
            message: "Disk full".into(),
        })
    );
}

#[test]
fn run_takes_everything_after_the_dashes() {
    assert_eq!(
        parse(&args("run -- cargo build --release")),
        Ok(Cli::Run {
            title: "cargo build".into(),
            icon: String::new(),
            command: args("cargo build --release"),
        })
    );
    assert_eq!(
        parse(&args(
            "run --title Deploy --icon network-server-symbolic -- ./deploy.sh --title x"
        )),
        Ok(Cli::Run {
            title: "Deploy".into(),
            icon: "network-server-symbolic".into(),
            command: args("./deploy.sh --title x"),
        })
    );
    assert!(parse(&args("run --")).is_err());
    assert!(parse(&args("run cargo build")).is_err());
}

#[test]
fn default_title_is_the_program_and_its_first_word() {
    assert_eq!(
        default_title(&args("/usr/bin/cargo build --release")),
        "cargo build"
    );
    assert_eq!(default_title(&args("make -j8")), "make");
    assert_eq!(default_title(&args("rsync")), "rsync");
}

#[test]
fn help_version_and_mistakes() {
    assert_eq!(parse(&[]), Ok(Cli::Help));
    assert_eq!(parse(&args("--help")), Ok(Cli::Help));
    assert_eq!(parse(&args("--version")), Ok(Cli::Version));
    assert!(parse(&args("activity set b --title B --colour red"))
        .unwrap_err()
        .contains("--colour"));
    assert!(parse(&args("dance")).unwrap_err().contains("dance"));
}

#[test]
fn settings_takes_no_options() {
    assert_eq!(parse(&args("settings")), Ok(Cli::Settings));
    assert!(parse(&args("settings --now")).is_err());
}
