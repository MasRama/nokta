import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    EMPTY_TIMER,
    breakAfterFocus,
    finishedAlert,
    formatRemaining,
    msUntilNextSecond,
    nextBreak,
    phaseColor,
    remainingAt,
    timerSnapshotFrom,
    toggleSubtitle,
    type TimerSnapshot,
} from '../src/features/timer/logic/timer.js';
import { DEFAULT_TIMER } from '../src/features/settings/logic/parse.js';

const S = 1_000_000;
const MIN = 60 * S;

const running = (remainingUs: number, timestampUs = 0, phase: 'focus' | 'break' = 'focus'): TimerSnapshot => ({
    state: 'running',
    phase,
    durationUs: 25 * MIN,
    remainingUs,
    timestampUs,
    sessions: 0,
    longBreak: false,
});

test('timer_from_properties', () => {
    const values: Record<string, unknown> = {
        State: 'paused',
        Phase: 'break',
        DurationUs: 5 * MIN,
        RemainingUs: 3 * MIN,
        TimestampUs: 42,
        Sessions: 0,
        LongBreak: true,
    };
    assert.deepEqual(timerSnapshotFrom((name) => values[name]), {
        state: 'paused',
        phase: 'break',
        durationUs: 5 * MIN,
        remainingUs: 3 * MIN,
        timestampUs: 42,
        sessions: 0,
        longBreak: true,
    });
});

test('an_idle_timer_keeps_its_session_count', () => {
    const values: Record<string, unknown> = { State: 'idle', Phase: '', Sessions: 3, LongBreak: false };
    assert.deepEqual(timerSnapshotFrom((name) => values[name]), { ...EMPTY_TIMER, sessions: 3 });
});

test('timer_from_unknown_or_missing_values_is_idle', () => {
    assert.deepEqual(timerSnapshotFrom(() => undefined), EMPTY_TIMER);
    const values: Record<string, unknown> = { State: 'snoozing', Phase: 'focus', RemainingUs: 5 };
    assert.equal(timerSnapshotFrom((name) => values[name]).state, 'idle');
});

test('remaining_counts_down_only_while_running', () => {
    assert.equal(remainingAt(running(10 * MIN, 1_000), 1_000 + MIN), 9 * MIN);
    assert.equal(remainingAt(running(10 * S, 0), 60 * S), 0);
    assert.equal(remainingAt({ ...running(10 * MIN), state: 'paused' }, 5 * MIN), 10 * MIN);
    assert.equal(remainingAt(EMPTY_TIMER, 5 * MIN), 0);
});

test('format_rounds_up_to_whole_seconds', () => {
    assert.equal(formatRemaining(25 * MIN), '25:00');
    assert.equal(formatRemaining(18 * MIN + 41 * S + 1), '18:42');
    assert.equal(formatRemaining(9 * S), '0:09');
    assert.equal(formatRemaining(0), '0:00');
    assert.equal(formatRemaining(-5), '0:00');
    assert.equal(formatRemaining(90 * MIN), '1:30:00');
});

test('next_tick_is_when_the_shown_second_changes', () => {
    // 18:41.75 left: "18:42" shows until 18:41.000, 0.75 s from now.
    assert.equal(msUntilNextSecond(running(18 * MIN + 41.75 * S), 0), 750);
    assert.equal(msUntilNextSecond(running(10 * S), 0), 1000);
    assert.equal(msUntilNextSecond(running(0), 0), null);
    assert.equal(msUntilNextSecond({ ...running(10 * S), state: 'paused' }, 0), null);
});

test('toggle_subtitle_by_state', () => {
    assert.equal(toggleSubtitle(EMPTY_TIMER, 0, 25), '25 min');
    assert.equal(toggleSubtitle(running(17 * MIN + 1), 0, 25), '18 min left');
    assert.equal(toggleSubtitle(running(3 * MIN, 0, 'break'), 0, 25), 'Break, 3 min left');
    assert.equal(
        toggleSubtitle({ ...running(3 * MIN, 0, 'break'), longBreak: true }, 0, 25),
        'Long break, 3 min left',
    );
    assert.equal(toggleSubtitle({ ...running(12 * MIN), state: 'paused' }, 0, 25), 'Paused, 12 min left');
    assert.equal(toggleSubtitle(running(20 * S), 0, 25), '1 min left');
});

test('finished_alerts', () => {
    const short = { minutes: 5, long: false };
    assert.deepEqual(finishedAlert('focus', short), { title: 'Focus done', detail: '5 min break' });
    assert.deepEqual(finishedAlert('focus', { minutes: 15, long: true }), {
        title: 'Focus done',
        detail: '15 min long break',
    });
    assert.deepEqual(finishedAlert('focus', { minutes: 0, long: false }), {
        title: 'Focus done',
        detail: 'Time for a break',
    });
    assert.deepEqual(finishedAlert('break', short), { title: 'Break over', detail: 'Ready to focus' });
    assert.equal(finishedAlert('nap', short), null);
});

test('the_next_break_is_long_once_enough_sessions_finished', () => {
    const settings = { ...DEFAULT_TIMER };
    assert.deepEqual(nextBreak({ ...EMPTY_TIMER, sessions: 3 }, settings), { minutes: 5, long: false });
    assert.deepEqual(nextBreak({ ...EMPTY_TIMER, sessions: 4 }, settings), { minutes: 15, long: true });
    const never = { ...settings, sessionsBeforeLongBreak: 0 };
    assert.deepEqual(nextBreak({ ...EMPTY_TIMER, sessions: 9 }, never), { minutes: 5, long: false });
});

test('the_break_after_focus_reads_either_order_of_updates', () => {
    const settings = { ...DEFAULT_TIMER };
    // Finished arrived first: the snapshot still shows the 4th focus session.
    assert.deepEqual(breakAfterFocus({ ...running(0), sessions: 3 }, settings), { minutes: 15, long: true });
    assert.deepEqual(breakAfterFocus({ ...running(0), sessions: 1 }, settings), { minutes: 5, long: false });
    // The new state arrived first: the break is running.
    const longBreak = { ...running(15 * MIN, 0, 'break'), longBreak: true };
    assert.deepEqual(breakAfterFocus(longBreak, settings), { minutes: 15, long: true });
    assert.deepEqual(breakAfterFocus({ ...running(5 * MIN, 0, 'break'), sessions: 3 }, settings), {
        minutes: 5,
        long: false,
    });
    // No short break: idle after the 3rd session, the long one is not due.
    const noBreak = { ...settings, breakMinutes: 0 };
    assert.deepEqual(breakAfterFocus({ ...EMPTY_TIMER, sessions: 3 }, noBreak), { minutes: 0, long: false });
});

test('phase_colors', () => {
    assert.equal(phaseColor('focus'), '#ff7b63');
    assert.equal(phaseColor('break'), '#57e389');
    assert.equal(phaseColor(''), '#ff7b63');
});
