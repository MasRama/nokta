import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extrapolatePosition } from '../src/shared/logic/position.js';

const base = { positionUs: 10_000_000, timestampUs: 1_000_000, rate: 1, playing: true, lengthUs: 200_000_000 };

test('paused_position_does_not_advance', () => {
    assert.equal(extrapolatePosition({ ...base, playing: false }, 9_000_000), 10_000_000);
});

test('playing_position_advances_with_rate', () => {
    assert.equal(extrapolatePosition(base, 3_000_000), 12_000_000);
    assert.equal(extrapolatePosition({ ...base, rate: 2 }, 3_000_000), 14_000_000);
});

test('position_clamps_to_length', () => {
    assert.equal(extrapolatePosition(base, 999_000_000), 200_000_000);
    assert.equal(extrapolatePosition({ ...base, positionUs: -5 }, 1_000_000), 0);
});

test('zero_length_is_not_clamped_above', () => {
    assert.equal(extrapolatePosition({ ...base, lengthUs: 0 }, 501_000_000), 510_000_000);
});

test('clock_before_snapshot_does_not_rewind', () => {
    assert.equal(extrapolatePosition(base, 0), 10_000_000);
});
