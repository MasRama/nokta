import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BAR_COUNT, barLevels, LEVEL_MAX, LEVEL_MIN } from '../src/features/media/logic/equalizer.js';

test('levels_stay_in_range_for_every_bar', () => {
    for (let t = 0; t < 60_000; t += 83) {
        const levels = barLevels(t);
        assert.equal(levels.length, BAR_COUNT);
        for (const level of levels) {
            assert.ok(level >= LEVEL_MIN && level <= LEVEL_MAX, `level ${level} at ${t}`);
        }
    }
});

test('levels_are_deterministic', () => {
    assert.deepEqual(barLevels(1234), barLevels(1234));
});

test('bars_move_independently', () => {
    const a = barLevels(0);
    const b = barLevels(500);
    assert.notDeepEqual(a, b);
    assert.ok(new Set(a.map((l) => l.toFixed(3))).size > 1, 'bars should not all match');
});

test('levels_cover_most_of_the_range', () => {
    let low = 1;
    let high = 0;
    for (let t = 0; t < 30_000; t += 83) {
        for (const level of barLevels(t)) {
            low = Math.min(low, level);
            high = Math.max(high, level);
        }
    }
    assert.ok(low < LEVEL_MIN + 0.1 && high > LEVEL_MAX - 0.1, `range ${low}..${high}`);
});
