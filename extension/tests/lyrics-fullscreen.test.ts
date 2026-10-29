import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fullscreenLines } from '../src/features/lyrics/logic/fullscreen.js';

const S = 1_000_000;
const LINES: Array<[number, string]> = [
    [1 * S, 'first'],
    [2 * S, '사랑해'],
    [3 * S, ''],
    [4 * S, 'last'],
];

test('the full-screen view shows the lines around the current one', () => {
    const lines = fullscreenLines(LINES, 2.5 * S, false);
    assert.equal(lines.index, 1);
    assert.deepEqual(
        [lines.previous.text, lines.current.text, lines.next.text],
        ['first', '사랑해', ''],
    );
});

test('before the first line and in a gap the current line is a note', () => {
    const before = fullscreenLines(LINES, 0, false);
    assert.deepEqual([before.index, before.previous.text, before.current.text, before.next.text], [-1, '', '♪', 'first']);
    assert.equal(fullscreenLines(LINES, 3.5 * S, false).current.text, '♪');
});

test('every korean or japanese line is romanized when romanizing is on', () => {
    const on = fullscreenLines(LINES, 1.5 * S, true);
    assert.deepEqual([on.current.romanized, on.next.romanized], [null, 'saranghae']);
    assert.equal(fullscreenLines(LINES, 2.5 * S, true).current.romanized, 'saranghae');
    assert.equal(fullscreenLines(LINES, 2.5 * S, false).current.romanized, null);
});
