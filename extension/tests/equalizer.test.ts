import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    BAR_COUNT,
    barLevels,
    barsFrom,
    easeBars,
    freshLevels,
    LEVEL_MAX,
    LEVEL_MIN,
    LEVELS_STALE_MS,
    rampLevels,
} from '../src/features/media/logic/equalizer.js';

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

test('levels_from_the_music_fill_the_bars_from_their_floor', () => {
    assert.deepEqual(barsFrom([0, 0.5, 1, 0]), [LEVEL_MIN, LEVEL_MIN + 0.5 * (LEVEL_MAX - LEVEL_MIN), LEVEL_MAX, LEVEL_MIN]);
    // Out of range or missing levels stay within the bars.
    assert.deepEqual(barsFrom([-1, 2]), [LEVEL_MIN, LEVEL_MAX, LEVEL_MIN, LEVEL_MIN]);
});

test('bars_rise_faster_than_they_fall', () => {
    const up = easeBars([0.25], [1])[0] - 0.25;
    const down = 1 - easeBars([1], [0.25])[0];
    assert.ok(up > down, `${up} ${down}`);
    assert.ok(up < 0.75 && down > 0, `${up} ${down}`);
});

test('levels_count_only_while_they_keep_coming', () => {
    const levels = [0.1, 0.2, 0.3, 0.4];
    assert.deepEqual(freshLevels(levels, 1000, 1000 + LEVELS_STALE_MS - 1), levels);
    assert.equal(freshLevels(levels, 1000, 1000 + LEVELS_STALE_MS), null);
    assert.equal(freshLevels(null, 1000, 1000), null);
    assert.equal(freshLevels([0.5], 1000, 1000), null, 'not one level per bar');
});

test('the bars rise from rest over a quarter second when the music starts', () => {
    const rest = [0.45, 0.75, 0.55, 0.35];
    const levels = [1, 0.25, 0.75, 0.55];
    assert.deepEqual(rampLevels(levels, 0, 250, rest), rest);
    const half = rampLevels(levels, 125, 250, rest);
    half.forEach((level, i) => assert.ok(Math.abs(level - (rest[i] + levels[i]) / 2) < 1e-9));
    assert.deepEqual(rampLevels(levels, 250, 250, rest), levels);
    assert.deepEqual(rampLevels(levels, 900, 250, rest), levels);
});
