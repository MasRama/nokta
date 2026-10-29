import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blobColors, fullscreenLines, lineOpacity } from '../src/features/lyrics/logic/fullscreen.js';
import { luminance } from '../src/shared/logic/color.js';

const S = 1_000_000;
const LINES: Array<[number, string]> = [
    [1 * S, 'first'],
    [2 * S, '사랑해'],
    [3 * S, ''],
    [4 * S, 'last'],
];

const texts = (lines: ReturnType<typeof fullscreenLines>) => [
    ...lines.before.map((l) => l.text),
    lines.current.text,
    ...lines.after.map((l) => l.text),
];

test('the full-screen view shows two lines before the current one and three after', () => {
    const lines = fullscreenLines(LINES, 2.5 * S, false);
    assert.equal(lines.index, 1);
    assert.deepEqual(texts(lines), ['', 'first', '사랑해', '', 'last', '']);
});

test('before the first line and in a gap the current line is a note', () => {
    const before = fullscreenLines(LINES, 0, false);
    assert.equal(before.index, -1);
    assert.deepEqual(texts(before), ['', '', '♪', 'first', '사랑해', '']);
    assert.equal(fullscreenLines(LINES, 3.5 * S, false).current.text, '♪');
});

test('every korean or japanese line is romanized when romanizing is on', () => {
    const on = fullscreenLines(LINES, 1.5 * S, true);
    assert.deepEqual([on.current.romanized, on.after[0].romanized], [null, 'saranghae']);
    assert.equal(fullscreenLines(LINES, 2.5 * S, true).current.romanized, 'saranghae');
    assert.equal(fullscreenLines(LINES, 2.5 * S, false).current.romanized, null);
});

test('lines fade the further they are from the current one', () => {
    assert.deepEqual([0, 1, 2, 3, 4].map(lineOpacity), [255, 115, 64, 36, 36]);
    assert.equal(lineOpacity(-1), lineOpacity(1));
});

test('the backdrop takes three colors near the cover\'s accent, dark enough for white text', () => {
    const colors = blobColors('#e0405a');
    assert.equal(colors.length, 3);
    assert.equal(new Set(colors).size, 3);
    for (const c of colors) {
        assert.match(c, /^#[0-9a-f]{6}$/);
        assert.ok(luminance(c) <= 0.25, c);
    }
});

test('without a cover accent the backdrop takes a quiet blue', () => {
    assert.deepEqual(blobColors(''), blobColors('#4a5a9a'));
});
