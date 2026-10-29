import assert from 'node:assert/strict';
import { test } from 'node:test';

import { flierTransform, flies, ROW_IN, staggerDelays } from '../src/shared/logic/morph.js';

const on = { morph: true, animations: true, indicator: false };

test('a flier laid on its own place stays put', () => {
    const r = { x: 18, y: 14, width: 64, height: 64 };
    assert.deepEqual(flierTransform(r, r), { x: 18, y: 14, scale: 1 });
});

test('the 64 px cover shrinks onto the 22 px one', () => {
    const big = { x: 18, y: 14, width: 64, height: 64 };
    assert.deepEqual(flierTransform({ x: 10, y: 5, width: 22, height: 22 }, big), { x: 10, y: 5, scale: 22 / 64 });
});

test('rows come in 30 ms apart and the last starts by 140 ms', () => {
    assert.deepEqual(staggerDelays(1), [40]);
    assert.deepEqual(staggerDelays(4), [40, 70, 100, 130]);
    const ten = staggerDelays(10);
    assert.equal(ten.length, 10);
    assert.equal(ten[0], 40);
    assert.ok(Math.abs((ten.at(-1) ?? 0) - 140) < 1e-9);
    assert.deepEqual(staggerDelays(0), []);
});

test('a row rises 6 px over 180 ms, so the reveal ends by 320 ms', () => {
    assert.deepEqual(ROW_IN, { rise: 6, ms: 180 });
    assert.ok((staggerDelays(20).at(-1) ?? 0) + ROW_IN.ms <= 320 + 1e-9);
});

test('the cover flies between the closed notch and the player, both ways', () => {
    assert.equal(flies('collapsed', 'expanded', on), 'cover');
    assert.equal(flies('expanded', 'collapsed', on), 'cover');
});

test('home from the closed notch flies the indicator, when one shows', () => {
    assert.equal(flies('idle', 'panel', { ...on, indicator: true }), 'indicator');
    assert.equal(flies('idle', 'panel', on), null);
});

test('other changes do not fly', () => {
    assert.equal(flies('collapsed', 'panel', on), null);
    assert.equal(flies('idle', 'osd', on), null);
    assert.equal(flies('expanded', 'expanded', on), null);
});

test('no flight with animations off', () => {
    assert.equal(flies('collapsed', 'expanded', { ...on, animations: false }), null);
    assert.equal(flies('idle', 'panel', { ...on, indicator: true, animations: false }), null);
});

test('no flight with morph off', () => {
    assert.equal(flies('collapsed', 'expanded', { ...on, morph: false }), null);
    assert.equal(flies('idle', 'panel', { ...on, indicator: true, morph: false }), null);
});
