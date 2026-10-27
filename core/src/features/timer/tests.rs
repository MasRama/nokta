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
