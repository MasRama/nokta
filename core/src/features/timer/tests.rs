use std::time::Duration;

use tokio::sync::{mpsc, watch};

use super::logic::{Phase, Snapshot, State, Timer};
use super::service::{self, Command};

const MIN: i64 = 60_000_000;

mod pure {
    use super::*;

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
        }
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
        t.start(Phase::Focus, 25 * MIN, 1_000);
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
        assert_eq!(t.expire(1_000 + 25 * MIN - 1), None);
        assert_eq!(t.expire(1_000 + 25 * MIN), Some(Phase::Focus));
        assert_eq!(t.snapshot(0).state, State::Idle);
    }

    #[test]
    fn pause_keeps_the_time_left_and_resume_moves_the_deadline() {
        let mut t = Timer::default();
        t.start(Phase::Break, 5 * MIN, 0);
        assert!(t.pause(2 * MIN));
        assert!(!t.pause(3 * MIN));
        assert_eq!(t.deadline(), None);
        assert_eq!(t.expire(10 * MIN), None);
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
        t.start(Phase::Focus, 25 * MIN, 0);
        t.start(Phase::Break, 5 * MIN, MIN);
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
        let (commands, state, finished) = service::spawn(move |phase| match phase {
            Phase::Focus => Duration::from_millis(focus_ms),
            Phase::Break => Duration::from_millis(break_ms),
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
