import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    EMPTY_TIMER,
    finishedAlert,
    formatRemaining,
    msUntilNextSecond,
    phaseColor,
    remainingAt,
    timerSnapshotFrom,
    toggleSubtitle,
    type TimerSnapshot,
} from '../src/features/timer/logic/timer.js';

const S = 1_000_000;
const MIN = 60 * S;

const running = (remainingUs: number, timestampUs = 0, phase: 'focus' | 'break' = 'focus'): TimerSnapshot => ({
    state: 'running',
    phase,
    durationUs: 25 * MIN,
    remainingUs,
    timestampUs,
});

test('timer_from_properties', () => {
    const values: Record<string, unknown> = {
        State: 'paused',
        Phase: 'break',
        DurationUs: 5 * MIN,
        RemainingUs: 3 * MIN,
        TimestampUs: 42,
    };
    assert.deepEqual(
        timerSnapshotFrom((name) => values[name]),
        { state: 'paused', phase: 'break', durationUs: 5 * MIN, remainingUs: 3 * MIN, timestampUs: 42 },
    );
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
    assert.equal(toggleSubtitle({ ...running(12 * MIN), state: 'paused' }, 0, 25), 'Paused, 12 min left');
    assert.equal(toggleSubtitle(running(20 * S), 0, 25), '1 min left');
});

test('finished_alerts', () => {
    assert.deepEqual(finishedAlert('focus', 5), { title: 'Focus done', detail: '5 min break' });
    assert.deepEqual(finishedAlert('focus', 0), { title: 'Focus done', detail: 'Time for a break' });
    assert.deepEqual(finishedAlert('break', 5), { title: 'Break over', detail: 'Ready to focus' });
    assert.equal(finishedAlert('nap', 5), null);
});

test('phase_colors', () => {
    assert.equal(phaseColor('focus'), '#ff7b63');
    assert.equal(phaseColor('break'), '#57e389');
    assert.equal(phaseColor(''), '#ff7b63');
});
