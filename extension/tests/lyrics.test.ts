import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentLineIndex, nextLineStartUs } from '../src/shared/logic/lyrics.js';

const lines: ReadonlyArray<readonly [number, string]> = [
    [1_000_000, 'one'],
    [2_000_000, 'two'],
    [3_500_000, 'three'],
];

test('index_before_first_line_is_minus_one', () => {
    assert.equal(currentLineIndex(lines, 999_999), -1);
    assert.equal(currentLineIndex([], 5_000_000), -1);
});

test('index_exact_boundary_selects_line', () => {
    assert.equal(currentLineIndex(lines, 1_000_000), 0);
    assert.equal(currentLineIndex(lines, 1_999_999), 0);
    assert.equal(currentLineIndex(lines, 2_000_000), 1);
    assert.equal(currentLineIndex(lines, 3_500_000), 2);
    assert.equal(currentLineIndex(lines, 99_000_000), 2);
});

test('next_line_start_after_last_is_null', () => {
    assert.equal(nextLineStartUs(lines, 0), 1_000_000);
    assert.equal(nextLineStartUs(lines, 2_500_000), 3_500_000);
    assert.equal(nextLineStartUs(lines, 3_500_000), null);
    assert.equal(nextLineStartUs([], 0), null);
});
