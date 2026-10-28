import assert from 'node:assert/strict';
import { test } from 'node:test';

import { progressLine, type LineInput, type Span } from '../src/shared/logic/progress-line.js';

const S = 1_000_000;
const span = (totalUs: number, leftUs: number, running = true, rate = 1): Span => ({ totalUs, leftUs, running, rate });
const input = (over: Partial<LineInput>): LineInput => ({
    indicator: null,
    collapsed: false,
    timer: null,
    clock: null,
    activity: -1,
    song: null,
    ...over,
});

test('the line follows the focus timer to its end, and stops while it is paused', () => {
    assert.deepEqual(progressLine(input({ indicator: 'timer', timer: span(10 * S, 4 * S) })), {
        fraction: 0.6,
        msToEnd: 4000,
    });
    assert.deepEqual(progressLine(input({ indicator: 'timer', timer: span(10 * S, 4 * S, false) })), {
        fraction: 0.6,
        msToEnd: null,
    });
});

test('a countdown shows its progress; a stopwatch or an alarm has none, so the song shows', () => {
    const song = span(200 * S, 150 * S);
    assert.deepEqual(progressLine(input({ indicator: 'clock', clock: span(60 * S, 15 * S) })), {
        fraction: 0.75,
        msToEnd: 15000,
    });
    assert.equal(progressLine(input({ indicator: 'clock' })), null);
    assert.deepEqual(progressLine(input({ indicator: 'clock', collapsed: true, song })), {
        fraction: 0.25,
        msToEnd: 150000,
    });
});

test('an activity shows its progress as it is; one without progress shows none', () => {
    assert.deepEqual(progressLine(input({ indicator: 'activity', activity: 0.3 })), { fraction: 0.3, msToEnd: null });
    assert.equal(progressLine(input({ indicator: 'activity', activity: -1 })), null);
});

test('a recording or a call has no line, not even the song', () => {
    const song = span(200 * S, 100 * S);
    assert.equal(progressLine(input({ indicator: 'recording', collapsed: true, song })), null);
    assert.equal(progressLine(input({ indicator: 'call', collapsed: true, song })), null);
});

test('otherwise the song shows while it plays beside the cover, at its rate', () => {
    const song = span(200 * S, 100 * S, true, 2);
    assert.deepEqual(progressLine(input({ collapsed: true, song })), { fraction: 0.5, msToEnd: 50000 });
    assert.deepEqual(progressLine(input({ indicator: 'shelf', collapsed: true, song })), {
        fraction: 0.5,
        msToEnd: 50000,
    });
    // Idle, or a song of unknown length: nothing.
    assert.equal(progressLine(input({ song })), null);
    assert.equal(progressLine(input({ collapsed: true, song: span(0, 0) })), null);
});

test('the line stays between empty and full', () => {
    assert.deepEqual(progressLine(input({ indicator: 'timer', timer: span(10 * S, -2 * S) })), {
        fraction: 1,
        msToEnd: 0,
    });
    assert.deepEqual(progressLine(input({ indicator: 'clock', clock: span(10 * S, 12 * S) })), {
        fraction: 0,
        msToEnd: 12000,
    });
});
