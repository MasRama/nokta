use std::time::Duration;

use tokio::sync::{mpsc, watch};

use super::logic::{Lengths, Phase, Snapshot, State, Timer};
use super::service::{self, Command};

const MIN: i64 = 60_000_000;

mod pure {
    use super::*;

    const LENGTHS: Lengths = Lengths {
        focus_us: 25 * MIN,
        break_us: 5 * MIN,
        long_break_us: 15 * MIN,
        sessions_before_long_break: 4,
    };

    fn snap(
        state: State,
        phase: Option<Phase>,
        duration: i64,
        remaining: i64,
        at: i64,
    ) -> Snapshot {
        Snapshot {
            state,
            phase,
            duration_us: duration,
            remaining_us: remaining,
            timestamp_us: at,
            ..Snapshot::default()
        }
    }

    /// Runs one focus session to its end; returns when it ended.
    fn finish_focus(t: &mut Timer, lengths: &Lengths, now: i64) -> i64 {
        assert!(t.start(Phase::Focus, lengths, now));
        let end = now + lengths.focus_us;
        assert_eq!(t.expire(end, lengths), Some(Phase::Focus));
        end
    }

    #[test]
    fn starts_idle() {
        let t = Timer::default();
        assert_eq!(t.snapshot(5), snap(State::Idle, None, 0, 0, 0));
        assert_eq!(t.deadline(), None);
    }

    #[test]
    fn running_counts_down_to_a_deadline() {
        let mut t = Timer::default();
        assert!(t.start(Phase::Focus, &LENGTHS, 1_000));
        assert_eq!(t.deadline(), Some(1_000 + 25 * MIN));
        assert_eq!(
            t.snapshot(1_000 + MIN),
            snap(
                State::Running,
                Some(Phase::Focus),
                25 * MIN,
                24 * MIN,
                1_000 + MIN
            )
        );
        assert_eq!(t.expire(1_000 + 25 * MIN - 1, &LENGTHS), None);
        assert_eq!(t.expire(1_000 + 25 * MIN, &LENGTHS), Some(Phase::Focus));
    }

    #[test]
    fn a_finished_focus_starts_the_break() {
        let mut t = Timer::default();
        let end = finish_focus(&mut t, &LENGTHS, 0);
        let s = t.snapshot(end);
        assert_eq!((s.state, s.phase), (State::Running, Some(Phase::Break)));
        assert_eq!(s.duration_us, 5 * MIN);
        assert_eq!((s.sessions, s.long_break), (1, false));
        assert_eq!(t.expire(end + 5 * MIN, &LENGTHS), Some(Phase::Break));
        assert_eq!(t.snapshot(0).state, State::Idle);
        assert_eq!(t.snapshot(0).sessions, 1);
    }

    #[test]
    fn every_fourth_session_ends_in_a_long_break() {
        let mut t = Timer::default();
        let mut now = 0;
        for session in 1..=3 {
            now = finish_focus(&mut t, &LENGTHS, now);
            assert_eq!(t.snapshot(now).sessions, session);
            assert!(!t.snapshot(now).long_break);
        }
        now = finish_focus(&mut t, &LENGTHS, now);
        let s = t.snapshot(now);
        assert_eq!(s.phase, Some(Phase::Break));
        assert!(s.long_break);
        assert_eq!(s.duration_us, 15 * MIN);
        // The count starts again with the long break.
        assert_eq!(s.sessions, 0);
        now = finish_focus(&mut t, &LENGTHS, now + 15 * MIN);
        assert!(!t.snapshot(now).long_break);
        assert_eq!(t.snapshot(now).sessions, 1);
    }

    #[test]
    fn a_break_started_by_hand_is_long_when_it_is_due() {
        let lengths = Lengths {
            break_us: 0,
            sessions_before_long_break: 2,
            ..LENGTHS
        };
        let mut t = Timer::default();
        let now = finish_focus(&mut t, &lengths, 0);
        // No short break: idle, and a short break cannot be started.
        assert_eq!(t.snapshot(now).state, State::Idle);
        assert!(!t.start(Phase::Break, &lengths, now));
        let now = finish_focus(&mut t, &lengths, now);
        assert!(t.snapshot(now).long_break);
        // Stop starts the count again, so the next break is the short one.
        assert!(t.stop());
        assert!(!t.start(Phase::Break, &lengths, now));
    }

    #[test]
    fn zero_sessions_means_no_long_breaks() {
        let lengths = Lengths {
            sessions_before_long_break: 0,
            ..LENGTHS
        };
        let mut t = Timer::default();
        let mut now = 0;
        for _ in 0..6 {
            now = finish_focus(&mut t, &lengths, now);
            assert!(!t.snapshot(now).long_break);
        }
        assert_eq!(t.snapshot(now).sessions, 6);
    }

    #[test]
    fn stop_resets_the_session_count() {
        let mut t = Timer::default();
        let now = finish_focus(&mut t, &LENGTHS, 0);
        assert!(t.stop());
        assert_eq!(t.snapshot(now).sessions, 0);
        assert!(!t.stop());
        // A count left from an earlier session is reset while idle too.
        finish_focus(&mut t, &LENGTHS, now);
        t.expire(i64::MAX, &LENGTHS);
        assert_eq!(t.snapshot(0).state, State::Idle);
        assert!(t.stop());
        assert_eq!(t.snapshot(0).sessions, 0);
    }

    #[test]
    fn pause_keeps_the_time_left_and_resume_moves_the_deadline() {
        let mut t = Timer::default();
        t.start(Phase::Break, &LENGTHS, 0);
        assert!(t.pause(2 * MIN));
        assert!(!t.pause(3 * MIN));
        assert_eq!(t.deadline(), None);
        assert_eq!(t.expire(10 * MIN, &LENGTHS), None);
        assert_eq!(
            t.snapshot(4 * MIN),
            snap(State::Paused, Some(Phase::Break), 5 * MIN, 3 * MIN, 4 * MIN)
        );
        assert!(t.resume(10 * MIN));
        assert!(!t.resume(11 * MIN));
        assert_eq!(t.deadline(), Some(13 * MIN));
    }

    #[test]
    fn stop_and_start_replace_the_timer() {
        let mut t = Timer::default();
        assert!(!t.stop());
        t.start(Phase::Focus, &LENGTHS, 0);
        t.start(Phase::Break, &LENGTHS, MIN);
        assert_eq!(t.deadline(), Some(6 * MIN));
        assert!(t.stop());
        assert_eq!(t.snapshot(0).state, State::Idle);
        assert!(!t.resume(0));
    }

    #[test]
    fn names_match_the_contract() {
        assert_eq!(State::Idle.as_str(), "idle");
        assert_eq!(State::Running.as_str(), "running");
        assert_eq!(State::Paused.as_str(), "paused");
        assert_eq!(Phase::parse("focus"), Some(Phase::Focus));
        assert_eq!(Phase::parse("break"), Some(Phase::Break));
        assert_eq!(Phase::parse("nap"), None);
        assert_eq!(Phase::Break.as_str(), "break");
    }
}

mod task {
    use super::*;

    struct Running {
        commands: mpsc::Sender<Command>,
        state: watch::Receiver<Snapshot>,
        finished: mpsc::Receiver<Phase>,
    }

    fn start(focus_ms: u64, break_ms: u64) -> Running {
        let ms = |ms: u64| i64::try_from(ms).unwrap() * 1_000;
        let (commands, state, finished) = service::spawn(move || Lengths {
            focus_us: ms(focus_ms),
            break_us: ms(break_ms),
            long_break_us: ms(break_ms),
            sessions_before_long_break: 0,
        });
        Running {
            commands,
            state,
            finished,
        }
    }

    async fn finished(r: &mut Running) -> Phase {
        tokio::time::timeout(Duration::from_secs(5), r.finished.recv())
            .await
            .expect("no Finished")
            .unwrap()
    }

    async fn state_becomes(r: &mut Running, f: impl Fn(&Snapshot) -> bool) -> Snapshot {
        tokio::time::timeout(Duration::from_secs(5), r.state.wait_for(f))
            .await
            .expect("state never matched")
            .unwrap()
            .clone()
    }

    #[tokio::test]
    async fn focus_then_break_then_idle() {
        let mut r = start(100, 150);
        r.commands.send(Command::Start(Phase::Focus)).await.unwrap();
        let s = state_becomes(&mut r, |s| s.state == State::Running).await;
        assert_eq!(s.phase, Some(Phase::Focus));
        assert_eq!(s.duration_us, 100_000);
        assert_eq!(finished(&mut r).await, Phase::Focus);
        let s = state_becomes(&mut r, |s| s.phase == Some(Phase::Break)).await;
        assert_eq!(s.state, State::Running);
        assert_eq!(finished(&mut r).await, Phase::Break);
        state_becomes(&mut r, |s| s.state == State::Idle).await;
    }

    #[tokio::test]
    async fn no_break_when_its_length_is_zero() {
        let mut r = start(30, 0);
        r.commands.send(Command::Start(Phase::Focus)).await.unwrap();
        assert_eq!(finished(&mut r).await, Phase::Focus);
        state_becomes(&mut r, |s| s.state == State::Idle).await;
        // A zero-length break cannot be started either.
        r.commands.send(Command::Start(Phase::Break)).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(r.state.borrow().state, State::Idle);
        assert!(r.finished.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_paused_timer_does_not_finish() {
        let mut r = start(80, 0);
        r.commands.send(Command::Start(Phase::Focus)).await.unwrap();
        r.commands.send(Command::Pause).await.unwrap();
        let s = state_becomes(&mut r, |s| s.state == State::Paused).await;
        assert!(s.remaining_us > 0 && s.remaining_us <= 80_000);
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(r.finished.try_recv().is_err());
        r.commands.send(Command::Resume).await.unwrap();
        assert_eq!(finished(&mut r).await, Phase::Focus);
    }

    #[tokio::test]
    async fn stop_ends_without_finished() {
        let mut r = start(60, 0);
        r.commands.send(Command::Start(Phase::Focus)).await.unwrap();
        r.commands.send(Command::Stop).await.unwrap();
        state_becomes(&mut r, |s| s.state == State::Idle).await;
        tokio::time::sleep(Duration::from_millis(120)).await;
        assert!(r.finished.try_recv().is_err());
    }
}

mod clocks {
    use super::super::clocks::{AddError, ClockView, Clocks, Done, Kind, MAX_CLOCKS};
    use super::MIN;

    const S: i64 = 1_000_000;
    const HOUR: i64 = 60 * MIN;
    /// A wall clock reading far from zero, like a real Unix time.
    const T: i64 = 1_800_000_000 * S;

    fn view(clocks: &Clocks, wall: i64, id: &str) -> ClockView {
        clocks
            .views(wall)
            .into_iter()
            .find(|v| v.id == id)
            .expect("clock exists")
    }

    #[test]
    fn countdown_counts_down_and_pauses() {
        let mut c = Clocks::default();
        let id = c.add_countdown("Tea", 5 * MIN, T).unwrap();
        let v = view(&c, T + MIN, &id);
        assert_eq!(v.kind, Kind::Countdown);
        assert_eq!(v.label, "Tea");
        assert!(v.running);
        assert_eq!(v.duration_us, 5 * MIN);
        assert_eq!(v.value_us, 4 * MIN);
        assert!(c.pause(&id, T + MIN));
        assert!(!c.pause(&id, T + MIN));
        assert_eq!(view(&c, T + 3 * MIN, &id).value_us, 4 * MIN);
        assert!(!view(&c, T + 3 * MIN, &id).running);
        assert!(c.resume(&id, T + 3 * MIN));
        assert!(!c.resume(&id, T + 3 * MIN));
        assert_eq!(view(&c, T + 4 * MIN, &id).value_us, 3 * MIN);
    }

    #[test]
    fn stopwatch_counts_up_and_pauses() {
        let mut c = Clocks::default();
        let id = c.add_stopwatch("", T).unwrap();
        assert_eq!(view(&c, T + 90 * S, &id).value_us, 90 * S);
        assert_eq!(view(&c, T, &id).duration_us, 0);
        c.pause(&id, T + 90 * S);
        assert_eq!(view(&c, T + HOUR, &id).value_us, 90 * S);
        c.resume(&id, T + HOUR);
        assert_eq!(view(&c, T + HOUR + 10 * S, &id).value_us, 100 * S);
    }

    #[test]
    fn alarm_counts_to_its_time_and_cannot_pause() {
        let mut c = Clocks::default();
        let id = c.add_alarm("Wake", T + 8 * HOUR, T).unwrap();
        let v = view(&c, T + HOUR, &id);
        assert_eq!(v.kind, Kind::Alarm);
        assert_eq!(v.value_us, 7 * HOUR);
        assert_eq!(v.alarm_unix_us, T + 8 * HOUR);
        assert!(!c.pause(&id, T + HOUR));
        assert!(view(&c, T + HOUR, &id).running);
    }

    #[test]
    fn newest_first_with_distinct_ids() {
        let mut c = Clocks::default();
        let a = c.add_countdown("a", MIN, T).unwrap();
        let b = c.add_stopwatch("b", T).unwrap();
        assert_ne!(a, b);
        let ids: Vec<String> = c.views(T).into_iter().map(|v| v.id).collect();
        assert_eq!(ids, [b, a]);
    }

    #[test]
    fn limits_are_checked() {
        let mut c = Clocks::default();
        assert_eq!(c.add_countdown("", 0, T), Err(AddError::BadLength));
        assert_eq!(c.add_countdown("", S - 1, T), Err(AddError::BadLength));
        assert_eq!(
            c.add_countdown("", 24 * HOUR + 1, T),
            Err(AddError::BadLength)
        );
        assert!(c.add_countdown("", 24 * HOUR, T).is_ok());
        assert_eq!(c.add_alarm("", T, T), Err(AddError::BadTime));
        assert_eq!(c.add_alarm("", T - S, T), Err(AddError::BadTime));
        assert_eq!(
            c.add_alarm("", T + 7 * 24 * HOUR + 1, T),
            Err(AddError::BadTime)
        );
        for _ in 1..MAX_CLOCKS {
            c.add_stopwatch("", T).unwrap();
        }
        assert_eq!(c.add_stopwatch("", T), Err(AddError::TooMany));
        assert_eq!(c.add_countdown("", MIN, T), Err(AddError::TooMany));
        assert_eq!(c.add_alarm("", T + HOUR, T), Err(AddError::TooMany));
    }

    #[test]
    fn next_due_is_the_soonest_running_countdown_or_alarm() {
        let mut c = Clocks::default();
        assert_eq!(c.next_due(T), None);
        c.add_stopwatch("", T).unwrap();
        assert_eq!(c.next_due(T), None);
        let long = c.add_countdown("", 10 * MIN, T).unwrap();
        c.add_alarm("", T + 3 * MIN, T).unwrap();
        assert_eq!(c.next_due(T + MIN), Some(2 * MIN));
        let short = c.add_countdown("", 30 * S, T + MIN).unwrap();
        assert_eq!(c.next_due(T + MIN), Some(30 * S));
        c.pause(&short, T + MIN);
        c.remove(&long);
        assert_eq!(c.next_due(T + MIN), Some(2 * MIN));
        // Past due reads as now.
        assert_eq!(c.next_due(T + 5 * MIN), Some(0));
    }

    #[test]
    fn expire_removes_what_is_due() {
        let mut c = Clocks::default();
        let tea = c.add_countdown("Tea", MIN, T).unwrap();
        let wake = c.add_alarm("Wake", T + 2 * MIN, T).unwrap();
        let later = c.add_countdown("", HOUR, T).unwrap();
        assert!(c.expire(T + MIN - 1).is_empty());
        assert_eq!(
            c.expire(T + 2 * MIN),
            [
                Done {
                    id: wake,
                    kind: Kind::Alarm,
                    label: "Wake".into()
                },
                Done {
                    id: tea,
                    kind: Kind::Countdown,
                    label: "Tea".into()
                },
            ]
        );
        let ids: Vec<String> = c.views(T).into_iter().map(|v| v.id).collect();
        assert_eq!(ids, [later]);
    }

    #[test]
    fn remove_and_clear_say_whether_anything_changed() {
        let mut c = Clocks::default();
        assert!(!c.clear());
        let id = c.add_stopwatch("", T).unwrap();
        assert!(!c.remove("nope"));
        assert!(c.remove(&id));
        assert!(!c.remove(&id));
        c.add_stopwatch("", T).unwrap();
        assert!(c.clear());
        assert!(c.views(T).is_empty());
    }

    #[test]
    fn kinds_have_names() {
        assert_eq!(Kind::Countdown.as_str(), "countdown");
        assert_eq!(Kind::Stopwatch.as_str(), "stopwatch");
        assert_eq!(Kind::Alarm.as_str(), "alarm");
    }
}

mod clocks_service {
    use std::time::Duration;

    use tokio::sync::{mpsc, oneshot, watch};
    use tokio::time::Instant;

    use super::super::clocks::{AddError, Done, Kind};
    use super::super::service::{spawn_clocks, ClockCommand, ClocksSnapshot};

    const S: i64 = 1_000_000;
    const T: i64 = 1_800_000_000 * S;

    struct Running {
        commands: mpsc::Sender<ClockCommand>,
        state: watch::Receiver<ClocksSnapshot>,
        done: mpsc::Receiver<Done>,
    }

    /// The wall clock follows tokio's paused clock, starting at T.
    fn start() -> Running {
        let origin = Instant::now();
        let wall = move || T + i64::try_from(origin.elapsed().as_micros()).unwrap();
        let (commands, state, done) = spawn_clocks(wall);
        Running {
            commands,
            state,
            done,
        }
    }

    async fn add_countdown(r: &Running, label: &str, us: i64) -> Result<String, AddError> {
        let (reply, rx) = oneshot::channel();
        r.commands
            .send(ClockCommand::AddCountdown {
                label: label.into(),
                duration_us: us,
                reply,
            })
            .await
            .unwrap();
        rx.await.unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn a_countdown_runs_out_and_is_removed() {
        let mut r = start();
        let id = add_countdown(&r, "Tea", 3 * S).await.unwrap();
        r.state.wait_for(|s| s.clocks.len() == 1).await.unwrap();
        let done = r.done.recv().await.unwrap();
        assert_eq!(
            done,
            Done {
                id,
                kind: Kind::Countdown,
                label: "Tea".into()
            }
        );
        r.state.wait_for(|s| s.clocks.is_empty()).await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn a_bad_length_is_refused() {
        let r = start();
        assert_eq!(add_countdown(&r, "", 0).await, Err(AddError::BadLength));
    }

    #[tokio::test(start_paused = true)]
    async fn a_removed_countdown_never_runs_out() {
        let mut r = start();
        let id = add_countdown(&r, "", 2 * S).await.unwrap();
        r.commands.send(ClockCommand::Remove(id)).await.unwrap();
        r.state.wait_for(|s| s.clocks.is_empty()).await.unwrap();
        tokio::time::sleep(Duration::from_secs(5)).await;
        assert!(r.done.try_recv().is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn an_alarm_goes_off_at_its_time() {
        let mut r = start();
        let (reply, rx) = oneshot::channel();
        r.commands
            .send(ClockCommand::AddAlarm {
                label: "Wake".into(),
                unix_us: T + 60 * S,
                reply,
            })
            .await
            .unwrap();
        rx.await.unwrap().unwrap();
        let before = Instant::now();
        assert_eq!(r.done.recv().await.unwrap().kind, Kind::Alarm);
        assert!(before.elapsed() >= Duration::from_secs(59));
    }

    #[tokio::test(start_paused = true)]
    async fn wake_republishes_with_a_new_timestamp() {
        let mut r = start();
        let (reply, rx) = oneshot::channel();
        r.commands
            .send(ClockCommand::AddStopwatch {
                label: String::new(),
                reply,
            })
            .await
            .unwrap();
        rx.await.unwrap().unwrap();
        let first = r
            .state
            .wait_for(|s| s.clocks.len() == 1)
            .await
            .unwrap()
            .timestamp_us;
        tokio::time::sleep(Duration::from_millis(10)).await;
        r.commands.send(ClockCommand::Wake).await.unwrap();
        r.state.changed().await.unwrap();
        assert_ne!(r.state.borrow().timestamp_us, first);
    }
}
