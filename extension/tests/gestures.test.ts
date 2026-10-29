import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ScrollTracker, SWIPE_GAP_MS } from '../src/features/gestures/logic/scroll.js';
import { VOLUME_STEP, steppedVolume, volumeIcon } from '../src/features/gestures/logic/volume.js';

test('a wheel click up or down is one volume step', () => {
    const t = new ScrollTracker();
    assert.equal(t.push(0, 0, 'up', 0), 'volume-up');
    assert.equal(t.push(0, 0, 'down', 10), 'volume-down');
});

test('smooth scrolling steps the volume once per unit', () => {
    const t = new ScrollTracker();
    assert.equal(t.push(0, -0.4, null, 0), null);
    assert.equal(t.push(0, -0.4, null, 10), null);
    assert.equal(t.push(0, -0.4, null, 20), 'volume-up');
    // 0.2 left over; 0.8 more is the next unit.
    assert.equal(t.push(0, -0.8, null, 30), 'volume-up');
    assert.equal(t.push(0, 1.2, null, 40), 'volume-down');
});

test('a swipe left skips to the next song once, right goes back', () => {
    const t = new ScrollTracker();
    assert.equal(t.push(-1.5, 0, null, 0), null);
    assert.equal(t.push(-1, 0, null, 10), 'next');
    assert.equal(t.push(-3, 0, null, 20), null);
    assert.equal(t.push(-3, 0, null, 200), null);
    // A pause ends the swipe; the next one acts again.
    const later = 200 + SWIPE_GAP_MS + 1;
    assert.equal(t.push(2.5, 0, null, later), 'previous');
});

test('a tilt wheel click left or right is one track', () => {
    const t = new ScrollTracker();
    assert.equal(t.push(0, 0, 'left', 0), 'next');
    assert.equal(t.push(0, 0, 'right', SWIPE_GAP_MS + 1), 'previous');
});

test('each event counts on its dominant axis', () => {
    const t = new ScrollTracker();
    assert.equal(t.push(-1.5, 0.3, null, 0), null);
    assert.equal(t.push(-1.5, 0.3, null, 10), 'next');
    // The small vertical parts never added up to a volume step.
    assert.equal(t.push(0, 0.5, null, 20), null);
});

test('a pause drops a part step of smooth scrolling', () => {
    const t = new ScrollTracker();
    assert.equal(t.push(0, -0.9, null, 0), null);
    assert.equal(t.push(0, -0.9, null, SWIPE_GAP_MS + 1), null);
});

test('the volume steps by 5 % within 0 and the normal maximum', () => {
    assert.equal(VOLUME_STEP, 0.05);
    assert.equal(steppedVolume(32768, 65536, 'volume-up'), 32768 + 3277);
    assert.equal(steppedVolume(65000, 65536, 'volume-up'), 65536);
    assert.equal(steppedVolume(1000, 65536, 'volume-down'), 0);
    // Above the normal maximum (set elsewhere), up does not push it further.
    assert.equal(steppedVolume(70000, 65536, 'volume-up'), 70000);
});

test("the volume's icon follows its level, as GNOME's", () => {
    assert.equal(volumeIcon(0, false), 'audio-volume-muted-symbolic');
    assert.equal(volumeIcon(0.5, true), 'audio-volume-muted-symbolic');
    assert.equal(volumeIcon(0.2, false), 'audio-volume-low-symbolic');
    assert.equal(volumeIcon(0.5, false), 'audio-volume-medium-symbolic');
    assert.equal(volumeIcon(0.9, false), 'audio-volume-high-symbolic');
});
