import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    clockColor,
    clockDetail,
    clockDoneAlert,
    clocksFrom,
    clockTitle,
    clockValueAt,
    clockText,
    indicatorClock,
    msUntilClockChange,
    type Clock,
} from '../src/features/timer/logic/clocks.js';

const S = 1_000_000;
const MIN = 60 * S;

const clock = (over: Partial<Clock>): Clock => ({
    id: 'c1',
    kind: 'countdown',
    label: '',
    running: true,
    durationUs: 10 * MIN,
    valueUs: 10 * MIN,
    timestampUs: 0,
    alarmUnixUs: 0,
    ...over,
});

test('clocksFrom reads the D-Bus rows and skips unknown kinds', () => {
    const rows = [
        ['c2', 'stopwatch', 'Run', false, 0, 5 * S, 100, 0],
        ['c1', 'countdown', '', true, MIN, 30 * S, 100, 0],
        ['c0', 'egg', '', true, 0, 0, 0, 0],
        'junk',
    ];
    assert.deepEqual(clocksFrom(rows), [
        clock({ id: 'c2', kind: 'stopwatch', label: 'Run', running: false, durationUs: 0, valueUs: 5 * S, timestampUs: 100 }),
        clock({ id: 'c1', durationUs: MIN, valueUs: 30 * S, timestampUs: 100 }),
    ]);
    assert.deepEqual(clocksFrom(undefined), []);
});

test('a running countdown counts down, a stopwatch up, a paused one holds', () => {
    assert.equal(clockValueAt(clock({ valueUs: MIN, timestampUs: 10 * S }), 25 * S), 45 * S);
    assert.equal(clockValueAt(clock({ valueUs: MIN }), 2 * MIN), 0);
    assert.equal(clockValueAt(clock({ kind: 'stopwatch', valueUs: 5 * S }), 10 * S), 15 * S);
    assert.equal(clockValueAt(clock({ running: false, valueUs: MIN }), 10 * MIN), MIN);
});

test('countdowns round up, stopwatches down', () => {
    assert.equal(clockText(clock({ valueUs: 61 * S - 1 }), 0), '1:01');
    assert.equal(clockText(clock({ kind: 'stopwatch', valueUs: 61 * S - 1 }), 0), '1:00');
    assert.equal(clockText(clock({ kind: 'stopwatch', valueUs: 3725 * S }), 0), '1:02:05');
});

test('titles fall back to the kind; details say the length, the time or paused', () => {
    assert.equal(clockTitle(clock({ label: 'Tea' })), 'Tea');
    assert.equal(clockTitle(clock({})), 'Timer');
    assert.equal(clockTitle(clock({ kind: 'stopwatch' })), 'Stopwatch');
    assert.equal(clockTitle(clock({ kind: 'alarm' })), 'Alarm');
    assert.equal(clockDetail(clock({ durationUs: 90 * MIN }), '07:30'), '1 h 30 min');
    assert.equal(clockDetail(clock({ durationUs: 45 * S }), ''), '45 s');
    assert.equal(clockDetail(clock({ running: false }), ''), 'Paused · 10 min');
    assert.equal(clockDetail(clock({ kind: 'stopwatch', running: false }), ''), 'Paused');
    assert.equal(clockDetail(clock({ kind: 'stopwatch' }), ''), '');
    assert.equal(clockDetail(clock({ kind: 'alarm' }), '07:30'), '07:30');
});

test('the closed notch shows the soonest countdown, then a stopwatch, then a paused clock', () => {
    const tea = clock({ id: 'tea', valueUs: 5 * MIN });
    const eggs = clock({ id: 'eggs', valueUs: 2 * MIN });
    const run = clock({ id: 'run', kind: 'stopwatch', valueUs: 0 });
    const paused = clock({ id: 'paused', running: false });
    assert.equal(indicatorClock([tea, run, eggs], 0)?.id, 'eggs');
    assert.equal(indicatorClock([paused, run], 0)?.id, 'run');
    assert.equal(indicatorClock([paused], 0)?.id, 'paused');
    assert.equal(indicatorClock([], 0), null);
});

test('an alarm shows in the closed notch only in its last hour', () => {
    const far = clock({ id: 'far', kind: 'alarm', durationUs: 0, valueUs: 2 * 60 * MIN });
    assert.equal(indicatorClock([far], 0), null);
    assert.equal(indicatorClock([far], 61 * MIN)?.id, 'far');
    const run = clock({ id: 'run', kind: 'stopwatch', valueUs: 0 });
    assert.equal(indicatorClock([run, far], 0)?.id, 'run');
    assert.equal(indicatorClock([run, far], 90 * MIN)?.id, 'far');
});

test('the next redraw is when the shown second changes or an alarm comes into its last hour', () => {
    assert.equal(msUntilClockChange([clock({ valueUs: 10 * S + 250_000 })], 0), 250);
    assert.equal(msUntilClockChange([clock({ kind: 'stopwatch', valueUs: 10 * S + 250_000 })], 0), 750);
    assert.equal(msUntilClockChange([clock({ running: false })], 0), null);
    const far = clock({ kind: 'alarm', durationUs: 0, valueUs: 2 * 60 * MIN });
    assert.equal(msUntilClockChange([far], 0), 60 * 60_000);
    assert.equal(msUntilClockChange([], 0), null);
});

test('a finished countdown or alarm alerts with its label', () => {
    assert.deepEqual(clockDoneAlert('countdown', 'Tea', '10:00'), { title: 'Tea', detail: 'Timer done' });
    assert.deepEqual(clockDoneAlert('countdown', '', '10:00'), { title: 'Timer done', detail: '' });
    assert.deepEqual(clockDoneAlert('alarm', 'Wake up', '07:30'), { title: 'Wake up', detail: 'Alarm · 07:30' });
    assert.deepEqual(clockDoneAlert('alarm', '', '07:30'), { title: 'Alarm', detail: '07:30' });
    assert.equal(clockDoneAlert('stopwatch', '', ''), null);
});

test('each kind has its own color', () => {
    const colors = new Set(['countdown', 'stopwatch', 'alarm'].map((k) => clockColor(k as Clock['kind'])));
    assert.equal(colors.size, 3);
});
