import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRESS_SCALE, pressState, pressTarget, RELEASE_MS } from '../src/shared/logic/press.js';

test('a press goes to the nearest button from the pointer up', () => {
    assert.equal(pressTarget([false, false, true, true]), 2);
    assert.equal(pressTarget([true]), 0);
    assert.equal(pressTarget([false]), -1);
    assert.equal(pressTarget([]), -1);
});

test('a press stays on its button until release or leave', () => {
    assert.equal(pressState('press'), true);
    assert.equal(pressState('release'), false);
    assert.equal(pressState('leave'), false);
    assert.equal(pressState('close'), false);
});

test('a pressed button shrinks a little and springs back in about a fifth of a second', () => {
    assert.equal(PRESS_SCALE, 0.92);
    assert.equal(RELEASE_MS, 220);
});
