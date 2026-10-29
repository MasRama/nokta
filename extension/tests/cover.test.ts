import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COVER_MS, coverLook, coverShadow } from '../src/features/media/logic/cover.js';

test("the open player's cover glows in its own color", () => {
    assert.equal(coverShadow('#c0392b', false), 'box-shadow: 0 6px 20px rgba(192, 57, 43, 0.55);');
});

test('on a light notch the glow is softer', () => {
    assert.equal(coverShadow('#c0392b', true), 'box-shadow: 0 6px 20px rgba(192, 57, 43, 0.35);');
});

test('without a cover color there is no glow', () => {
    assert.equal(coverShadow(null, false), '');
    assert.equal(coverShadow('', false), '');
    assert.equal(coverShadow('not a color', false), '');
});

test('the closed cover dims and shrinks a little while paused', () => {
    assert.deepEqual(coverLook(false), { opacity: 178, scale: 0.9 });
    assert.deepEqual(coverLook(true), { opacity: 255, scale: 1 });
    assert.equal(COVER_MS, 260);
});
