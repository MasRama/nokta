import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lyricWindow, romanizedRows } from '../src/features/lyrics/logic/window.js';

const S = 1_000_000;
const LINES = [
    [1 * S, 'a'],
    [2 * S, 'b'],
    [3 * S, 'c'],
    [4 * S, 'd'],
    [5 * S, 'e'],
] as const;

test('the window centers the current line', () => {
    assert.deepEqual(lyricWindow(LINES, 3.5 * S, 7), { current: 2, rows: ['', 'a', 'b', 'c', 'd', 'e', ''] });
});

test('the window pads before the first line', () => {
    assert.deepEqual(lyricWindow(LINES, 0, 7), { current: -1, rows: ['', '', '', '', 'a', 'b', 'c'] });
    assert.deepEqual(lyricWindow(LINES, 1 * S, 7), { current: 0, rows: ['', '', '', 'a', 'b', 'c', 'd'] });
});

test('the window pads after the last line', () => {
    assert.deepEqual(lyricWindow(LINES, 60 * S, 7), { current: 4, rows: ['b', 'c', 'd', 'e', '', '', ''] });
});

test('the window of no lines is empty', () => {
    assert.deepEqual(lyricWindow([], 10 * S, 3), { current: -1, rows: ['', '', ''] });
});

test('the romanized line takes the row under the current one', () => {
    const rows = ['a', 'b', 'c', '사랑해', 'e', 'f', 'g'];
    assert.deepEqual(romanizedRows(rows, 'saranghae'), ['a', 'b', 'c', '사랑해', 'saranghae', 'e', 'f']);
    assert.deepEqual(romanizedRows(rows, null), rows);
});
