//! `Timer1`: the focus timer and the clocks beside it, from the core.
//!
//! On D-Bus `TimestampUs` and each clock's timestamp are on the monotonic
//! clock the extension reads; the page has none, so here they are on the
//! wall clock in µs, the page's `Date.now() * 1000`, as `Media1`'s.

use nokta_core::features::timer::clocks::Done;
use nokta_core::features::timer::logic::{Phase, Snapshot, State};
use nokta_core::features::timer::service::{ClocksSnapshot, Command};
use serde_json::{json, Value};

use super::Props;

pub const INTERFACE: &str = "Timer1";
pub const FINISHED: &str = "Finished";
pub const CLOCK_DONE: &str = "ClockDone";

/// `mono_us` on the wall clock; `now_mono_us` and `now_wall_us` are the
/// same moment on both.
fn on_wall(mono_us: i64, now_mono_us: i64, now_wall_us: i64) -> i64 {
    now_wall_us - (now_mono_us - mono_us)
}

/// The focus timer's properties.
pub fn props(s: &Snapshot, now_mono_us: i64, now_wall_us: i64) -> Props {
    let mut props = Props::new();
    for (name, value) in [
        ("State", json!(s.state.as_str())),
        ("Phase", json!(s.phase.map_or("", Phase::as_str))),
        ("DurationUs", json!(s.duration_us)),
        ("RemainingUs", json!(s.remaining_us)),
        (
            "TimestampUs",
            json!(on_wall(s.timestamp_us, now_mono_us, now_wall_us)),
        ),
        ("Sessions", json!(s.sessions)),
        ("LongBreak", json!(s.long_break)),
    ] {
        props.insert(name.into(), value);
    }
    props
}

/// The `Clocks` property, each clock as the D-Bus struct's fields in order.
pub fn clock_props(s: &ClocksSnapshot, now_mono_us: i64, now_wall_us: i64) -> Props {
    let timestamp = on_wall(s.timestamp_us, now_mono_us, now_wall_us);
    let clocks: Vec<Value> = s
        .clocks
        .iter()
        .map(|c| {
            json!([
                c.id,
                c.kind.as_str(),
                c.label,
                c.running,
                c.duration_us,
                c.value_us,
                timestamp,
                c.alarm_unix_us
            ])
        })
        .collect();
    let mut props = Props::new();
    props.insert("Clocks".into(), Value::Array(clocks));
    props
}

/// `Finished`'s arguments.
pub fn finished_args(phase: &Phase) -> Vec<Value> {
    vec![json!(phase.as_str())]
}

/// `ClockDone`'s arguments.
pub fn clock_done_args(done: &Done) -> Vec<Value> {
    vec![json!(done.id), json!(done.kind.as_str()), json!(done.label)]
}

/// What the open shortcut's twin for focus does, like a click on the Focus
/// tile: starts focus when the timer is idle, else stops it.
pub fn focus_shortcut(state: State) -> Command {
    match state {
        State::Idle => Command::Start(Phase::Focus),
        State::Running | State::Paused => Command::Stop,
    }
}

/// A method of `Timer1`, read from the page's call.
#[derive(Debug, PartialEq, Eq)]
pub enum Call {
    Timer(Command),
    AddCountdown { label: String, duration_us: i64 },
    AddStopwatch { label: String },
    AddAlarm { label: String, unix_us: i64 },
    PauseClock(String),
    ResumeClock(String),
    RemoveClock(String),
    ClearClocks,
}

fn micros(value: &Value, what: &str) -> Result<i64, String> {
    value
        .as_f64()
        .filter(|us| us.is_finite())
        .map(|us| us.round() as i64)
        .ok_or_else(|| format!("{what} must be a number"))
}

/// The call for `method` with `args`, as `contracts/io.nokta.Timer1.xml` has them.
pub fn call(method: &str, args: &[Value]) -> Result<Call, String> {
    Ok(match (method, args) {
        ("Start", [Value::String(phase)]) => Call::Timer(Command::Start(
            Phase::parse(phase).ok_or_else(|| format!("no timer phase {phase:?}"))?,
        )),
        ("Pause", []) => Call::Timer(Command::Pause),
        ("Resume", []) => Call::Timer(Command::Resume),
        ("Stop", []) => Call::Timer(Command::Stop),
        ("AddCountdown", [Value::String(label), duration]) => Call::AddCountdown {
            label: label.clone(),
            duration_us: micros(duration, "the length")?,
        },
        ("AddStopwatch", [Value::String(label)]) => Call::AddStopwatch {
            label: label.clone(),
        },
        ("AddAlarm", [Value::String(label), time]) => Call::AddAlarm {
            label: label.clone(),
            unix_us: micros(time, "the time")?,
        },
        ("PauseClock", [Value::String(id)]) => Call::PauseClock(id.clone()),
        ("ResumeClock", [Value::String(id)]) => Call::ResumeClock(id.clone()),
        ("RemoveClock", [Value::String(id)]) => Call::RemoveClock(id.clone()),
        ("ClearClocks", []) => Call::ClearClocks,
        _ => {
            return Err(format!(
                "no method {INTERFACE}.{method} for {} arguments",
                args.len()
            ))
        }
    })
}

#[cfg(test)]
mod tests {
    use nokta_core::features::timer::clocks::{ClockView, Kind};

    use super::*;

    #[test]
    fn stamps_the_timer_on_the_wall_clock() {
        let snapshot = Snapshot {
            state: State::Running,
            phase: Some(Phase::Focus),
            duration_us: 1_500_000_000,
            remaining_us: 1_200_000_000,
            timestamp_us: 9_000,
            sessions: 2,
            long_break: false,
        };
        let props = props(&snapshot, 10_000, 1_700_000_000_000_000);
        assert_eq!(props["State"], json!("running"));
        assert_eq!(props["Phase"], json!("focus"));
        assert_eq!(props["TimestampUs"], json!(1_699_999_999_999_000_i64));
        assert_eq!(props["Sessions"], json!(2));
    }

    #[test]
    fn lists_each_clock_as_the_contracts_struct() {
        let snapshot = ClocksSnapshot {
            clocks: vec![ClockView {
                id: "c1".into(),
                kind: Kind::Countdown,
                label: "Tea".into(),
                running: true,
                duration_us: 180_000_000,
                value_us: 120_000_000,
                alarm_unix_us: 0,
            }],
            timestamp_us: 500,
        };
        let props = clock_props(&snapshot, 1_000, 2_000);
        assert_eq!(
            props["Clocks"],
            json!([[
                "c1",
                "countdown",
                "Tea",
                true,
                180_000_000,
                120_000_000,
                1_500,
                0
            ]])
        );
    }

    #[test]
    fn reads_each_method() {
        assert_eq!(
            call("Start", &[json!("break")]),
            Ok(Call::Timer(Command::Start(Phase::Break)))
        );
        assert_eq!(call("Stop", &[]), Ok(Call::Timer(Command::Stop)));
        assert_eq!(
            call("AddCountdown", &[json!(""), json!(300_000_000.0)]),
            Ok(Call::AddCountdown {
                label: String::new(),
                duration_us: 300_000_000
            })
        );
        assert_eq!(
            call("PauseClock", &[json!("c1")]),
            Ok(Call::PauseClock("c1".into()))
        );
        assert!(call("Start", &[json!("nap")]).is_err());
        assert!(call("AddCountdown", &[json!(""), json!("soon")]).is_err());
        assert!(call("Explode", &[]).is_err());
    }

    #[test]
    fn the_focus_shortcut_starts_focus_or_stops() {
        assert_eq!(focus_shortcut(State::Idle), Command::Start(Phase::Focus));
        assert_eq!(focus_shortcut(State::Running), Command::Stop);
        assert_eq!(focus_shortcut(State::Paused), Command::Stop);
    }
}
