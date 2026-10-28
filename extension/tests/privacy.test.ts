import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dotsFor, dotsPlace, NO_PRIVACY } from '../src/features/privacy/logic/dots.js';

test('no_dots_when_nothing_is_in_use_or_the_setting_is_off', () => {
    assert.deepEqual(dotsFor(NO_PRIVACY, true), []);
    assert.deepEqual(dotsFor({ camera: true, microphone: true, screen: true }, false), []);
});

test('green_for_the_camera_orange_for_the_microphone_or_the_screen', () => {
    assert.deepEqual(dotsFor({ ...NO_PRIVACY, camera: true }, true), ['camera']);
    assert.deepEqual(dotsFor({ ...NO_PRIVACY, microphone: true }, true), ['recording']);
    assert.deepEqual(dotsFor({ ...NO_PRIVACY, screen: true }, true), ['recording']);
    assert.deepEqual(dotsFor({ camera: true, microphone: true, screen: true }, true), ['camera', 'recording']);
});

test('the first dot sits in the middle of the rounded corner, the row centered on the closed notch', () => {
    // 32 px tall, 14 px corners, 5 px dots 4 px apart: the first dot's
    // center is 14 px from the left, like the corner's circle.
    assert.deepEqual(dotsPlace(32, 14, 1), { left: 12, top: 14, contentLeft: 25 });
    assert.deepEqual(dotsPlace(32, 14, 2), { left: 12, top: 14, contentLeft: 34 });
    // Square corners still keep the dot off the edge.
    assert.deepEqual(dotsPlace(33, 0, 1), { left: 8, top: 14, contentLeft: 21 });
    assert.equal(dotsPlace(32, 14, 0).contentLeft, 0);
});
