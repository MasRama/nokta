import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatClock, formatDuration, sizeLabel, uses24h } from '../src/shared/logic/format.js';

test('format_duration_minutes_and_hours', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(61_000_000), '1:01');
    assert.equal(formatDuration(59_999_999), '0:59');
    assert.equal(formatDuration(3_723_000_000), '1:02:03');
    assert.equal(formatDuration(-1), '0:00');
});

test('format_clock_24h_and_12h', () => {
    const afternoon = new Date(2026, 9, 27, 13, 5);
    assert.equal(formatClock(afternoon, true), '13:05');
    assert.equal(formatClock(afternoon, false), '1:05');
    const midnight = new Date(2026, 9, 27, 0, 7);
    assert.equal(formatClock(midnight, true), '00:07');
    assert.equal(formatClock(midnight, false), '12:07');
});

test('clock_format_choice', () => {
    assert.equal(uses24h('24h', '12h'), true);
    assert.equal(uses24h('12h', '24h'), false);
    assert.equal(uses24h('system', '24h'), true);
    assert.equal(uses24h('system', '12h'), false);
    assert.equal(uses24h('weird', '24h'), true);
    assert.equal(uses24h('weird', '12h'), false);
    const fivePm = new Date(2026, 9, 27, 17, 0);
    assert.equal(formatClock(fivePm, uses24h('24h', '12h')), '17:00');
});

test('sizes read like GNOME Files, in powers of 1000', () => {
    assert.equal(sizeLabel(0), '0 B');
    assert.equal(sizeLabel(999), '999 B');
    assert.equal(sizeLabel(1023), '1.0 kB');
    assert.equal(sizeLabel(2_400_000), '2.4 MB');
    assert.equal(sizeLabel(999_960), '1.0 MB');
    assert.equal(sizeLabel(4_700_000_000), '4.7 GB');
    assert.equal(sizeLabel(3_200_000_000_000), '3.2 TB');
});
