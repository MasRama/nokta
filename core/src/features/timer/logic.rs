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

/// Phase lengths and the long-break rule, read when a phase starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Lengths {
    pub focus_us: i64,
    pub break_us: i64,
    pub long_break_us: i64,
    /// Focus sessions before a long break; 0 means never.
    pub sessions_before_long_break: u32,
}

/// What `io.nokta.Timer1` publishes: the time left at `timestamp_us`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub state: State,
    pub phase: Option<Phase>,
    pub duration_us: i64,
    pub remaining_us: i64,
    pub timestamp_us: i64,
    /// Focus sessions finished since the last long break or stop.
    pub sessions: u32,
    pub long_break: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Timer {
    inner: Inner,
    sessions: u32,
}

#[derive(Clone, Copy, Debug, Default)]
enum Inner {
    #[default]
    Idle,
    Running {
        phase: Phase,
        long: bool,
        duration_us: i64,
        deadline_us: i64,
    },
    Paused {
        phase: Phase,
        long: bool,
        duration_us: i64,
        remaining_us: i64,
    },
}

impl Timer {
    /// Starts `phase`, replacing whatever ran before. A break is the long
    /// one when enough focus sessions finished; it starts the count again.
    /// A phase of length 0 does not start: returns false, nothing changes.
    pub fn start(&mut self, phase: Phase, lengths: &Lengths, now: i64) -> bool {
        let every = lengths.sessions_before_long_break;
        let long = phase == Phase::Break && every > 0 && self.sessions >= every;
        let duration_us = match phase {
            Phase::Focus => lengths.focus_us,
            Phase::Break if long => lengths.long_break_us,
            Phase::Break => lengths.break_us,
        };
        if duration_us <= 0 {
            return false;
        }
        if long {
            self.sessions = 0;
        }
        self.inner = Inner::Running {
            phase,
            long,
            duration_us,
            deadline_us: now.saturating_add(duration_us),
        };
        true
    }

    /// True when a running timer was paused.
    pub fn pause(&mut self, now: i64) -> bool {
        let Inner::Running {
            phase,
            long,
            duration_us,
            deadline_us,
        } = self.inner
        else {
            return false;
        };
        self.inner = Inner::Paused {
            phase,
            long,
            duration_us,
            remaining_us: (deadline_us - now).max(0),
        };
        true
    }

    /// True when a paused timer was resumed.
    pub fn resume(&mut self, now: i64) -> bool {
        let Inner::Paused {
            phase,
            long,
            duration_us,
            remaining_us,
        } = self.inner
        else {
            return false;
        };
        self.inner = Inner::Running {
            phase,
            long,
            duration_us,
            deadline_us: now + remaining_us,
        };
        true
    }

    /// Ends the timer and starts the session count again. True when there
    /// was a timer or a count to reset.
    pub fn stop(&mut self) -> bool {
        let changed = !matches!(self.inner, Inner::Idle) || self.sessions > 0;
        self.inner = Inner::Idle;
        self.sessions = 0;
        changed
    }

    /// When a running timer ends.
    pub fn deadline(&self) -> Option<i64> {
        match self.inner {
            Inner::Running { deadline_us, .. } => Some(deadline_us),
            _ => None,
        }
    }

    /// Ends a running timer whose deadline has passed and returns its phase.
    /// A finished focus session counts and starts the break.
    pub fn expire(&mut self, now: i64, lengths: &Lengths) -> Option<Phase> {
        match self.inner {
            Inner::Running {
                phase, deadline_us, ..
            } if now >= deadline_us => {
                self.inner = Inner::Idle;
                if phase == Phase::Focus {
                    self.sessions += 1;
                    self.start(Phase::Break, lengths, now);
                }
                Some(phase)
            }
            _ => None,
        }
    }

    pub fn snapshot(&self, now: i64) -> Snapshot {
        let sessions = self.sessions;
        match self.inner {
            Inner::Idle => Snapshot {
                sessions,
                ..Snapshot::default()
            },
            Inner::Running {
                phase,
                long,
                duration_us,
                deadline_us,
            } => Snapshot {
                state: State::Running,
                phase: Some(phase),
                duration_us,
                remaining_us: (deadline_us - now).max(0),
                timestamp_us: now,
                sessions,
                long_break: long,
            },
            Inner::Paused {
                phase,
                long,
                duration_us,
                remaining_us,
            } => Snapshot {
                state: State::Paused,
                phase: Some(phase),
                duration_us,
                remaining_us,
                timestamp_us: now,
                sessions,
                long_break: long,
            },
        }
    }
}
