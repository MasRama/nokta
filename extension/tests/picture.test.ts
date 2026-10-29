import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PICTURE_HEIGHT, pictureRect } from '../src/shared/logic/shape.js';

const MONITOR = { x: 0, width: 1920 };
const WIDTHS = { idleWidth: 180, playingWidth: 260, expandedWidth: 420, osdWidth: 300 };

test('the picture spans the widest notch, centred on the monitor', () => {
    // Laid out at its widest, the picture fills the shape from its left edge.
    assert.deepEqual(pictureRect(MONITOR, 420, 8, WIDTHS), { x: 0, y: 0, width: 436, height: PICTURE_HEIGHT });
});

test('a narrower notch is a window onto the same spot of the picture', () => {
    const wide = pictureRect(MONITOR, 420, 8, WIDTHS);
    const closed = pictureRect(MONITOR, 180, 8, WIDTHS);
    assert.equal(closed.width, wide.width);
    // The closed shape starts 120 px right of the open one: the picture moves left by as much.
    assert.equal(closed.x, -120);
});

test('the picture is as wide as the widest size the settings give', () => {
    assert.equal(pictureRect(MONITOR, 420, 8, { ...WIDTHS, osdWidth: 600 }).width, 616);
});

test('the picture stays put on a second monitor', () => {
    const second = { x: 1920, width: 2560 };
    const left = (w: number) => 1920 + Math.round((2560 - w - 16) / 2);
    for (const laid of [180, 260, 420]) {
        const r = pictureRect(second, laid, 8, WIDTHS);
        assert.equal(left(laid) + r.x + r.width / 2, 1920 + 1280, String(laid));
    }
});
