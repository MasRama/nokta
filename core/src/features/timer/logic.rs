//! The timer itself, with no clock: every method takes `now` in monotonic
//! microseconds.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Focus,
    Break,
}

impl Phase {
    pub fn parse(name: &str) -> Option<Phase> {
        match name {
            "focus" => Some(Phase::Focus),
            "break" => Some(Phase::Break),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Focus => "focus",
            Phase::Break => "break",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum State {
    #[default]
    Idle,
    Running,
    Paused,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Idle => "idle",
            State::Running => "running",
            State::Paused => "paused",
        }
    }
}

/// What `io.nokta.Timer1` publishes: the time left at `timestamp_us`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub state: State,
    pub phase: Option<Phase>,
    pub duration_us: i64,
    pub remaining_us: i64,
    pub timestamp_us: i64,
}

#[derive(Clone, Debug, Default)]
pub struct Timer {
    inner: Inner,
}

#[derive(Clone, Debug, Default)]
enum Inner {
    #[default]
    Idle,
    Running {
        phase: Phase,
        duration_us: i64,
        deadline_us: i64,
    },
    Paused {
        phase: Phase,
        duration_us: i64,
        remaining_us: i64,
    },
}

impl Timer {
    /// Starts `phase`, replacing whatever ran before.
    pub fn start(&mut self, phase: Phase, duration_us: i64, now: i64) {
        self.inner = Inner::Running {
            phase,
            duration_us,
            deadline_us: now + duration_us,
        };
    }

    /// True when a running timer was paused.
    pub fn pause(&mut self, now: i64) -> bool {
        let Inner::Running {
            phase,
            duration_us,
            deadline_us,
        } = self.inner
        else {
            return false;
        };
        self.inner = Inner::Paused {
            phase,
            duration_us,
            remaining_us: (deadline_us - now).max(0),
        };
        true
    }

    /// True when a paused timer was resumed.
    pub fn resume(&mut self, now: i64) -> bool {
        let Inner::Paused {
            phase,
            duration_us,
            remaining_us,
        } = self.inner
        else {
            return false;
        };
        self.inner = Inner::Running {
            phase,
            duration_us,
            deadline_us: now + remaining_us,
        };
        true
    }

    /// True when there was a timer to stop.
    pub fn stop(&mut self) -> bool {
        let was_set = !matches!(self.inner, Inner::Idle);
        self.inner = Inner::Idle;
        was_set
    }

    /// When a running timer ends.
    pub fn deadline(&self) -> Option<i64> {
        match self.inner {
            Inner::Running { deadline_us, .. } => Some(deadline_us),
            _ => None,
        }
    }

    /// Ends a running timer whose deadline has passed and returns its phase.
    pub fn expire(&mut self, now: i64) -> Option<Phase> {
        match self.inner {
            Inner::Running {
                phase, deadline_us, ..
            } if now >= deadline_us => {
                self.inner = Inner::Idle;
                Some(phase)
            }
            _ => None,
        }
    }

    pub fn snapshot(&self, now: i64) -> Snapshot {
        match self.inner {
            Inner::Idle => Snapshot::default(),
            Inner::Running {
                phase,
                duration_us,
                deadline_us,
            } => Snapshot {
                state: State::Running,
                phase: Some(phase),
                duration_us,
                remaining_us: (deadline_us - now).max(0),
                timestamp_us: now,
            },
            Inner::Paused {
                phase,
                duration_us,
                remaining_us,
            } => Snapshot {
                state: State::Paused,
                phase: Some(phase),
                duration_us,
                remaining_us,
                timestamp_us: now,
            },
        }
    }
}
