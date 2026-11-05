use super::card::{self, Card};
use super::manifest::{self, OptionKind, OptionValue};
use super::saved;
use crate::shared::paths::System;

const HELLO: &str = r#"
api = 1
id = "hello"
name = "Hello"
description = "Says hello"
version = "1.0.0"
author = "Nokta"
icon = "nokta-plugin"

[run]
command = ["./hello.sh"]
windows = ["powershell", "-File", "hello.ps1"]
every = 60

[[options]]
key = "name"
title = "Your name"
type = "text"
default = "world"

[[options]]
key = "size"
title = "Size"
type = "int"
min = 1
max = 5
default = 3

[[options]]
key = "mood"
title = "Mood"
type = "choice"
choices = ["happy", "calm"]
"#;

#[test]
fn reads_a_manifest() {
    let m = manifest::parse(HELLO).unwrap();
    assert_eq!(m.id, "hello");
    assert_eq!(m.name, "Hello");
    assert_eq!(m.run.every, 60);
    assert_eq!(m.run.timeout, 20, "the default timeout");
    assert_eq!(m.argv(System::Linux).unwrap(), ["./hello.sh"]);
    assert_eq!(m.argv(System::Windows).unwrap()[0], "powershell");
    assert_eq!(m.options.len(), 3);
    assert_eq!(m.options[0].default, OptionValue::Text("world".into()));
    assert_eq!(m.options[1].kind, OptionKind::Int { min: 1, max: 5 });
    assert_eq!(
        m.options[2].default,
        OptionValue::Text("happy".into()),
        "the first choice"
    );
}

#[test]
fn a_plugin_without_a_windows_command_does_not_run_there() {
    let text = HELLO.replace("windows = [\"powershell\", \"-File\", \"hello.ps1\"]\n", "");
    let m = manifest::parse(&text).unwrap();
    assert!(m.argv(System::Windows).is_none());
    assert!(m.argv(System::MacOs).is_some());
}

#[test]
fn refuses_broken_manifests() {
    let cases = [
        (HELLO.replace("api = 1", ""), "api = 1 is missing"),
        (HELLO.replace("api = 1", "api = 2"), "needs a newer Nokta"),
        (
            HELLO.replace("id = \"hello\"", "id = \"Hello World\""),
            "id is",
        ),
        (HELLO.replace("every = 60", "every = 2"), "every is"),
        (HELLO.replace("[run]", "[runs]"), "unknown field"),
        (
            HELLO.replace("default = 3", "default = 9"),
            "default does not fit",
        ),
        (
            HELLO.replace("type = \"int\"", "type = \"float\""),
            "is text, bool, int or choice",
        ),
        (
            HELLO.replace("key = \"size\"", "key = \"name\""),
            "there twice",
        ),
        (
            HELLO.replace("icon = \"nokta-plugin\"", "icon = \"../etc\""),
            "icon is",
        ),
        (
            HELLO.replace(
                "command = [\"./hello.sh\"]\nwindows = [\"powershell\", \"-File\", \"hello.ps1\"]",
                "",
            ),
            "needs command or windows",
        ),
    ];
    for (text, error) in cases {
        let got = manifest::parse(&text).unwrap_err();
        assert!(got.contains(error), "{got:?} should say {error:?}");
    }
}

#[test]
fn option_values_from_the_settings_window_are_checked() {
    let m = manifest::parse(HELLO).unwrap();
    let [name, size, mood] = &m.options[..] else {
        panic!()
    };
    assert_eq!(name.parse("Ren"), Ok(OptionValue::Text("Ren".into())));
    assert_eq!(size.parse(" 4 "), Ok(OptionValue::Int(4)));
    assert!(size.parse("9").unwrap_err().contains("from 1 to 5"));
    assert!(size.parse("x").is_err());
    assert_eq!(mood.parse("calm"), Ok(OptionValue::Text("calm".into())));
    assert!(mood.parse("angry").unwrap_err().contains("happy, calm"));
}

#[test]
fn saved_values_fall_back_to_the_default_when_they_no_longer_fit() {
    let m = manifest::parse(HELLO).unwrap();
    let saved =
        saved::parse("[hello]\nenabled = true\n[hello.options]\nname = \"Ren\"\nsize = 99\n")
            .unwrap();
    let values = saved::values(&m, saved.get("hello"));
    assert_eq!(
        values,
        vec![
            ("name".into(), OptionValue::Text("Ren".into())),
            ("size".into(), OptionValue::Int(3)),
            ("mood".into(), OptionValue::Text("happy".into())),
        ]
    );
    let again = saved::parse(&saved::to_text(&saved)).unwrap();
    assert_eq!(again, saved, "what is written reads back the same");
    assert!(saved::parse("[hello]\nenabled = 3").is_err());
}

#[test]
fn reads_a_card() {
    let card = card::parse(
        r#"{"title":"3 open pull requests","detail":"nokta","icon":"nokta-link","tone":"blue",
            "progress":1.5,"badge":"3","extra":true,
            "items":[{"title":"Fix it","open":"https://github.com/x"},{"title":"Bad link","open":"file:///etc/passwd"},{"detail":"no title"}],
            "actions":[{"label":"Open","open":"https://github.com"},{"label":"Rerun","run":"rerun"},{"label":"Third","run":"x"}]}"#,
    )
    .unwrap();
    assert_eq!(card.title, "3 open pull requests");
    assert_eq!(card.tone, "blue");
    assert_eq!(card.progress, Some(1.0), "clamped");
    assert_eq!(card.badge, "3");
    assert_eq!(card.items.len(), 2, "an item needs a title");
    assert_eq!(card.items[0].open, "https://github.com/x");
    assert_eq!(card.items[1].open, "", "only http(s) opens");
    assert_eq!(card.actions.len(), 2, "two at most");
    assert_eq!(card.actions[1].run, "rerun");
    assert!(card.shows());
}

#[test]
fn a_card_drops_what_does_not_fit() {
    let card = card::parse(
        r#"{"title":"a\u0007b","icon":"../../x","tone":"neon","badge":"123456789",
            "actions":[{"label":"Bad","run":"rm -rf"},{"label":"Nothing"},{"label":"Js","open":"javascript:alert(1)"}],
            "progress":"half"}"#,
    )
    .unwrap();
    assert_eq!(card.title, "a b");
    assert_eq!(card.icon, "");
    assert_eq!(card.tone, "");
    assert_eq!(card.badge, "1234567…");
    assert!(card.actions.is_empty());
    assert_eq!(card.progress, None);
}

#[test]
fn takes_the_last_json_line_after_other_output() {
    let card = card::parse("warming up\n{\"title\":\"one\"}\n{\"title\":\"two\"}\n").unwrap();
    assert_eq!(card.title, "two");
    assert_eq!(card::parse("").unwrap_err(), "printed nothing");
    assert_eq!(
        card::parse("hello").unwrap_err(),
        "did not print a JSON object"
    );
    assert_eq!(
        card::parse("[1,2]").unwrap_err(),
        "did not print a JSON object"
    );
}

#[test]
fn a_hidden_card_shows_nothing_but_keeps_its_alert() {
    let card = card::parse(r#"{"hidden":true,"title":"x","alert":{"title":"Done","detail":"ok"}}"#)
        .unwrap();
    assert!(!card.shows());
    let alert = card.alert.unwrap();
    assert_eq!(alert.id, "Done", "the title stands in for a missing id");
    assert!(!alert.important);
    let json = Card {
        title: "t".into(),
        ..Card::default()
    }
    .to_json();
    assert!(!json.contains("alert") && !json.contains("progress"));
}

#[cfg(unix)]
mod unix {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::time::Duration;

    use tokio::sync::{mpsc, oneshot};

    use super::super::runner::{self, Event, Spec};
    use super::super::service::{self, Command, Dirs};
    use crate::shared::paths::System;

    fn script(dir: &Path, name: &str, body: &str) {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn spec(dir: &Path, every: u32) -> Spec {
        Spec {
            id: "hello".into(),
            dir: dir.to_owned(),
            argv: vec!["./hello.sh".into()],
            data: dir.join("data"),
            every,
            timeout: 5,
            env: vec![("NOKTA_OPTION_NAME".into(), "Ren".into())],
        }
    }

    #[tokio::test]
    async fn runs_a_plugin_with_its_options_and_action() {
        let dir = tempfile::tempdir().unwrap();
        script(
            dir.path(),
            "hello.sh",
            r#"test -d "$NOKTA_PLUGIN_DATA" || exit 9
printf '{"title":"Hello %s","detail":"%s %s"}' "$NOKTA_OPTION_NAME" "$NOKTA_PLUGIN" "${NOKTA_ACTION:-none}""#,
        );
        let card = runner::run_once(&spec(dir.path(), 60), None).await.unwrap();
        assert_eq!(card.title, "Hello Ren");
        assert_eq!(card.detail, "hello none");
        let card = runner::run_once(&spec(dir.path(), 60), Some("wave"))
            .await
            .unwrap();
        assert_eq!(card.detail, "hello wave");
    }

    #[tokio::test]
    async fn a_failing_or_slow_plugin_says_why() {
        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "hello.sh", "echo 'no token set' >&2\nexit 3");
        let err = runner::run_once(&spec(dir.path(), 60), None)
            .await
            .unwrap_err();
        assert_eq!(err, "exited with 3: no token set");

        script(dir.path(), "hello.sh", "sleep 5");
        let mut slow = spec(dir.path(), 60);
        slow.timeout = 1;
        let err = runner::run_once(&slow, None).await.unwrap_err();
        assert_eq!(err, "took longer than 1 s");

        let mut missing = spec(dir.path(), 60);
        missing.argv = vec!["./nothing.sh".into()];
        assert!(runner::run_once(&missing, None)
            .await
            .unwrap_err()
            .starts_with("cannot start"));

        script(
            dir.path(),
            "hello.sh",
            "head -c 70000 /dev/zero | tr '\\0' a",
        );
        let err = runner::run_once(&spec(dir.path(), 60), None)
            .await
            .unwrap_err();
        assert_eq!(err, "printed more than 64 KiB");
    }

    async fn next(heard: &mut mpsc::Receiver<Event>) -> Event {
        tokio::time::timeout(Duration::from_secs(5), heard.recv())
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn a_stream_plugin_prints_a_card_per_line_and_hears_actions() {
        let dir = tempfile::tempdir().unwrap();
        script(
            dir.path(),
            "hello.sh",
            r#"echo '{"title":"started"}'
while read -r line; do
  case "$line" in *wave*) echo '{"title":"waved"}' ;; esac
done"#,
        );
        let (events, mut heard) = mpsc::channel(8);
        let runner = runner::spawn(spec(dir.path(), 0), events);
        let Event::Card(_, card) = next(&mut heard).await else {
            panic!()
        };
        assert_eq!(card.title, "started");
        runner.actions.send("wave".into()).await.unwrap();
        let Event::Card(_, card) = next(&mut heard).await else {
            panic!()
        };
        assert_eq!(card.title, "waved");
        drop(runner);
    }

    const MANIFEST: &str = "api = 1\nid = \"hello\"\nname = \"Hello\"\n[run]\ncommand = [\"./hello.sh\"]\nevery = 60\n[[options]]\nkey = \"name\"\ntitle = \"Name\"\ntype = \"text\"\ndefault = \"world\"\n";

    async fn ask<T>(
        commands: &mpsc::Sender<Command>,
        make: impl FnOnce(oneshot::Sender<Result<T, String>>) -> Command,
    ) -> Result<T, String> {
        let (reply, answer) = oneshot::channel();
        commands.send(make(reply)).await.unwrap();
        answer.await.unwrap()
    }

    #[tokio::test]
    async fn installs_turns_on_shows_cards_and_removes_a_plugin() {
        let home = tempfile::tempdir().unwrap();
        let source = home.path().join("source");
        std::fs::create_dir_all(source.join(".git")).unwrap();
        std::fs::write(source.join("plugin.toml"), MANIFEST).unwrap();
        script(
            &source,
            "hello.sh",
            r#"printf '{"title":"Hello %s","badge":"1","alert":{"id":"a1","title":"Hi"}}' "$NOKTA_OPTION_NAME""#,
        );
        let dirs = Dirs {
            plugins_dir: home.path().join("data/plugins"),
            saved_file: home.path().join("config/plugins.toml"),
        };
        let mut handle = service::spawn(dirs.clone(), System::Linux);
        let commands = handle.commands.clone();

        let id = ask(&commands, |reply| Command::Install {
            path: source.clone(),
            reply,
        })
        .await;
        assert_eq!(id.as_deref(), Ok("hello"));
        assert!(dirs.plugins_dir.join("hello/hello.sh").exists());
        assert!(
            !dirs.plugins_dir.join("hello/.git").exists(),
            ".git is left out"
        );
        let state = handle.state.borrow().clone();
        assert_eq!(state.plugins.len(), 1);
        assert!(!state.plugins[0].enabled, "a new plugin starts off");
        assert_eq!(state.plugins[0].status, "off");
        assert!(state.plugins[0].info.contains("\"value\":\"world\""));

        ask(&commands, |reply| Command::SetOption {
            id: "hello".into(),
            key: "name".into(),
            value: "Ren".into(),
            reply,
        })
        .await
        .unwrap();
        ask(&commands, |reply| Command::SetEnabled {
            id: "hello".into(),
            enabled: true,
            reply,
        })
        .await
        .unwrap();
        let saved = std::fs::read_to_string(&dirs.saved_file).unwrap();
        assert!(
            saved.contains("enabled = true") && saved.contains("name = \"Ren\""),
            "{saved}"
        );

        let alert = tokio::time::timeout(Duration::from_secs(5), handle.alerts.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(alert.title, "Hi");
        let cards = handle
            .state
            .wait_for(|s| !s.cards.is_empty())
            .await
            .unwrap()
            .cards
            .clone();
        assert_eq!(cards[0].0, "hello");
        assert!(cards[0].1.contains("\"title\":\"Hello Ren\""));
        assert_eq!(handle.state.borrow().plugins[0].status, "ok");
        assert!(
            dirs.plugins_dir.join(".data/hello").is_dir(),
            "its data folder is made"
        );

        // The same alert id does not show again.
        ask(&commands, |reply| Command::Run {
            id: "hello".into(),
            action: String::new(),
            reply,
        })
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(handle.alerts.try_recv().is_err());
        assert!(ask(&commands, |reply| Command::Run {
            id: "hello".into(),
            action: "rm -rf".into(),
            reply
        })
        .await
        .is_err());

        ask(&commands, |reply| Command::Remove {
            id: "hello".into(),
            reply,
        })
        .await
        .unwrap();
        assert!(!dirs.plugins_dir.join("hello").exists());
        assert!(
            !dirs.plugins_dir.join(".data/hello").exists(),
            "what it kept goes too"
        );
        assert!(handle.state.borrow().plugins.is_empty());
        assert!(handle.state.borrow().cards.is_empty());
        assert!(!std::fs::read_to_string(&dirs.saved_file)
            .unwrap()
            .contains("[hello]"));
    }

    #[tokio::test]
    async fn a_broken_plugin_is_listed_with_why_and_cannot_be_turned_on() {
        let home = tempfile::tempdir().unwrap();
        let plugins_dir = home.path().join("plugins");
        std::fs::create_dir_all(plugins_dir.join("other")).unwrap();
        std::fs::write(plugins_dir.join("other/plugin.toml"), MANIFEST).unwrap();
        let dirs = Dirs {
            plugins_dir,
            saved_file: home.path().join("plugins.toml"),
        };
        let handle = service::spawn(dirs, System::Linux);
        let mut state = handle.state.clone();
        let state = state
            .wait_for(|s| !s.plugins.is_empty())
            .await
            .unwrap()
            .clone();
        assert_eq!(state.plugins[0].status, "broken");
        assert!(state.plugins[0].message.contains("its folder is other"));
        let err = ask(&handle.commands, |reply| Command::SetEnabled {
            id: "other".into(),
            enabled: true,
            reply,
        })
        .await;
        assert!(err.is_err());
    }
}
