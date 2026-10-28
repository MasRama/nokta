import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LAST_LINE_US, lineProgress, nextLyric } from '../src/features/lyrics/logic/karaoke.js';

const S = 1_000_000;
const lines: Array<[number, string]> = [
    [1 * S, 'first'],
    [3 * S, ''],
    [4 * S, 'third'],
    [8 * S, 'last'],
];

test('the fill follows the time through the current line', () => {
    assert.deepEqual(lineProgress(lines, 1 * S, 1), { index: 0, fraction: 0, msLeft: 2000 });
    assert.deepEqual(lineProgress(lines, 2 * S, 1), { index: 0, fraction: 0.5, msLeft: 1000 });
    assert.deepEqual(lineProgress(lines, 7 * S, 1), { index: 2, fraction: 0.75, msLeft: 1000 });
});

test('the playback rate shortens the time left, not the fraction', () => {
    assert.deepEqual(lineProgress(lines, 2 * S, 2), { index: 0, fraction: 0.5, msLeft: 500 });
});

test('the intro and breaks are lit at once', () => {
    assert.deepEqual(lineProgress(lines, 0.5 * S, 1), { index: -1, fraction: 1, msLeft: 0 });
    assert.deepEqual(lineProgress(lines, 3.5 * S, 1), { index: 1, fraction: 1, msLeft: 0 });
});

test('the last line fills over a fixed time', () => {
    const half = lineProgress(lines, 8 * S + LAST_LINE_US / 2, 1);
    assert.equal(half.index, 3);
    assert.equal(half.fraction, 0.5);
    assert.deepEqual(lineProgress(lines, 60 * S, 1), { index: 3, fraction: 1, msLeft: 0 });
});

test('the next line skips breaks and ends after the last', () => {
    assert.equal(nextLyric(lines, 0), 'first');
    assert.equal(nextLyric(lines, 2 * S), 'third');
    assert.equal(nextLyric(lines, 5 * S), 'last');
    assert.equal(nextLyric(lines, 9 * S), null);
    assert.equal(nextLyric([], 0), null);
});
