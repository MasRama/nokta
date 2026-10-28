use super::model::{Activities, Ended, SetError, Update, MAX_ACTIVITIES};

const MIN: i64 = 60_000_000;
const STALE: i64 = 30 * MIN;

fn update(title: &str, progress: f64) -> Update {
    Update {
        title: title.into(),
        detail: String::new(),
        icon: String::new(),
        progress,
    }
}

mod pure {
    use super::*;

    #[test]
    fn set_starts_and_updates_keeping_the_start_time() {
        let mut a = Activities::default();
        assert_eq!(a.set("build", update("cargo build", -1.0), 100), Ok(None));
        let mut next = update("cargo build", 0.5);
        next.detail = "nokta-core".into();
        assert_eq!(a.set("build", next, 900), Ok(None));
        let list = a.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "build");
        assert_eq!(list[0].detail, "nokta-core");
        assert_eq!(list[0].progress, 0.5);
        assert_eq!(list[0].started_us, 100);
    }

    #[test]
    fn newest_first() {
        let mut a = Activities::default();
        a.set("one", update("One", -1.0), 1).unwrap();
        a.set("two", update("Two", -1.0), 2).unwrap();
        a.set("one", update("One", 0.2), 3).unwrap();
        let ids: Vec<_> = a.list().iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, ["two", "one"]);
    }

    #[test]
    fn a_ninth_ends_the_oldest() {
        let mut a = Activities::default();
        for i in 0..MAX_ACTIVITIES {
            a.set(&format!("a{i}"), update("A", -1.0), i as i64)
                .unwrap();
        }
        let ended = a.set("new", update("New", -1.0), 50).unwrap();
        assert_eq!(
            ended,
            Some(Ended {
                id: "a0".into(),
                title: "A".into(),
                success: false,
                message: "Replaced by a newer activity".into(),
                elapsed_us: 50,
            })
        );
        assert_eq!(a.list().len(), MAX_ACTIVITIES);
        assert_eq!(a.list()[0].id, "new");
    }

    #[test]
    fn invalid_updates_are_refused() {
        let mut a = Activities::default();
        assert_eq!(a.set("", update("T", -1.0), 0), Err(SetError::EmptyId));
        assert_eq!(a.set("x", update("  ", -1.0), 0), Err(SetError::EmptyTitle));
        assert_eq!(
            a.set("x", update("T", 1.5), 0),
            Err(SetError::Progress(1.5))
        );
        assert_eq!(
            a.set("x", update("T", -0.5), 0),
            Err(SetError::Progress(-0.5))
        );
        assert!(a.set("x", update("T", f64::NAN), 0).is_err());
        assert!(a.set("x", update("T", 0.0), 0).is_ok());
        assert!(a.set("x", update("T", 1.0), 0).is_ok());
        assert_eq!(a.list().len(), 1);
    }

    #[test]
    fn end_reports_how_long_it_ran() {
        let mut a = Activities::default();
        a.set("b", update("Backup", 0.9), 1_000).unwrap();
        assert_eq!(
            a.end("b", true, "1204 files", 93_000),
            Some(Ended {
                id: "b".into(),
                title: "Backup".into(),
                success: true,
                message: "1204 files".into(),
                elapsed_us: 92_000,
            })
        );
        assert!(a.list().is_empty());
        assert_eq!(a.end("b", true, "", 94_000), None);
    }

    #[test]
    fn an_activity_without_updates_goes_stale() {
        let mut a = Activities::default();
        a.set("old", update("Old", -1.0), 0).unwrap();
        a.set("new", update("New", -1.0), 10 * MIN).unwrap();
        assert_eq!(a.next_deadline(STALE), Some(STALE));
        assert!(a.expire(STALE - 1, STALE).is_empty());
        let ended = a.expire(STALE, STALE);
        assert_eq!(ended.len(), 1);
        assert_eq!(ended[0].id, "old");
        assert!(!ended[0].success);
        assert_eq!(ended[0].message, "No update for 30 minutes");
        assert_eq!(a.next_deadline(STALE), Some(40 * MIN));
    }

    #[test]
    fn an_update_moves_the_stale_deadline() {
        let mut a = Activities::default();
        a.set("x", update("X", -1.0), 0).unwrap();
        a.set("x", update("X", 0.1), 20 * MIN).unwrap();
        assert!(a.expire(STALE, STALE).is_empty());
        assert_eq!(a.next_deadline(STALE), Some(50 * MIN));
    }

    #[test]
    fn stale_message_names_the_time() {
        let mut a = Activities::default();
        a.set("x", update("X", -1.0), 0).unwrap();
        assert_eq!(a.expire(MIN, MIN)[0].message, "No update for 1 minute");
        a.set("y", update("Y", -1.0), 0).unwrap();
        assert_eq!(
            a.expire(90 * MIN, 90 * MIN)[0].message,
            "No update for 90 minutes"
        );
    }

    #[test]
    fn nothing_to_wait_for_without_activities() {
        assert_eq!(Activities::default().next_deadline(STALE), None);
    }
}

mod service {
    use std::time::Duration;

    use tokio::sync::oneshot;

    use super::super::model::Activity;
    use super::super::service::{self, Command, Handle};
    use super::*;

    async fn set(h: &Handle, id: &str, u: Update) -> Result<(), SetError> {
        let (reply, rx) = oneshot::channel();
        h.commands
            .send(Command::Set {
                id: id.into(),
                update: u,
                reply,
            })
            .await
            .unwrap();
        rx.await.unwrap()
    }

    async fn list_becomes(h: &mut Handle, f: impl Fn(&[Activity]) -> bool) -> Vec<Activity> {
        tokio::time::timeout(Duration::from_secs(2), h.state.wait_for(|l| f(l)))
            .await
            .expect("state in time")
            .unwrap()
            .clone()
    }

    async fn next_ended(h: &mut Handle) -> Ended {
        tokio::time::timeout(Duration::from_secs(2), h.ended.recv())
            .await
            .expect("Ended in time")
            .unwrap()
    }

    #[tokio::test]
    async fn set_publishes_and_end_reports() {
        let mut h = service::spawn(|| 30 * MIN);
        set(&h, "build", update("cargo build", -1.0)).await.unwrap();
        let list = list_becomes(&mut h, |l| l.len() == 1).await;
        assert_eq!(list[0].title, "cargo build");
        h.commands
            .send(Command::End {
                id: "build".into(),
                success: true,
                message: String::new(),
            })
            .await
            .unwrap();
        let ended = next_ended(&mut h).await;
        assert_eq!(ended.id, "build");
        assert!(ended.success);
        list_becomes(&mut h, <[Activity]>::is_empty).await;
    }

    #[tokio::test]
    async fn invalid_set_is_answered_with_the_error() {
        let h = service::spawn(|| 30 * MIN);
        assert_eq!(set(&h, "", update("T", -1.0)).await, Err(SetError::EmptyId));
    }

    #[tokio::test]
    async fn a_stale_activity_ends_on_its_own() {
        let mut h = service::spawn(|| 60_000);
        set(&h, "x", update("X", -1.0)).await.unwrap();
        let ended = next_ended(&mut h).await;
        assert_eq!(ended.id, "x");
        assert!(!ended.success);
        list_becomes(&mut h, <[Activity]>::is_empty).await;
    }
}
