import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dotsFor, dotsTop, NO_PRIVACY } from '../src/features/privacy/logic/dots.js';

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

test('dots_are_centered_on_the_closed_notch', () => {
    // 32 px tall, 5 px dots, 3 px apart.
    assert.equal(dotsTop(32, 1), 13);
    assert.equal(dotsTop(32, 2), 9);
    assert.equal(dotsTop(16, 2), 1);
    assert.equal(dotsTop(32, 0), 0);
});
