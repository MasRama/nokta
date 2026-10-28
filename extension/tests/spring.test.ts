import assert from 'node:assert/strict';
import { test } from 'node:test';

import { radiusAt } from '../src/shared/logic/shape.js';
import { settled, springFor, stepSpring, type SpringParams, type SpringState } from '../src/shared/logic/spring.js';

const FRAME_MS = 16;

/** Runs a spring from `from` to `to` frame by frame; the values it passed and the time it took. */
function run(from: number, to: number, params: SpringParams): { values: number[]; ms: number } {
    let state: SpringState = { value: from, velocity: 0 };
    const values: number[] = [];
    let ms = 0;
    while (!settled(state, to) && ms < 5000) {
        state = stepSpring(state, to, FRAME_MS, params);
        values.push(state.value);
        ms += FRAME_MS;
    }
    return { values, ms };
}

test('every kind of resize reaches its target and settles', () => {
    for (const kind of ['open', 'close', 'width'] as const) {
        const { values, ms } = run(32, 182, springFor(kind, 1));
        assert.ok(Math.abs(values[values.length - 1] - 182) < 0.5, kind);
        assert.ok(ms < 1200, `${kind} took ${ms} ms`);
    }
});

test('opening overshoots a little, closing never does', () => {
    const open = run(32, 182, springFor('open', 1)).values;
    const peak = Math.max(...open);
    assert.ok(peak > 182, 'open overshoots');
    assert.ok(peak - 182 < 150 * 0.06, `open overshoots by ${peak - 182} px`);
    const close = run(182, 32, springFor('close', 1)).values;
    assert.ok(Math.min(...close) >= 31.5, 'close stays above its target');
});

test('a new target mid-way keeps the motion going without a jump', () => {
    const params = springFor('open', 1);
    let state: SpringState = { value: 32, velocity: 0 };
    for (let i = 0; i < 8; i++) state = stepSpring(state, 182, FRAME_MS, params);
    assert.ok(state.velocity > 0);
    const before = state.value;
    // The pointer left: back to the closed height, from where it is now.
    const close = springFor('close', 1);
    const next = stepSpring(state, 32, FRAME_MS, close);
    // The upward velocity carried over: it ends higher than a fresh start would.
    const fresh = stepSpring({ value: before, velocity: 0 }, 32, FRAME_MS, close);
    assert.ok(next.value > fresh.value);
    assert.ok(Math.abs(next.value - before) < 20);
});

test('the animation speed setting stretches the time', () => {
    const normal = run(32, 182, springFor('width', 1)).ms;
    const slow = run(32, 182, springFor('width', 2)).ms;
    assert.ok(slow > normal * 1.6 && slow < normal * 2.4, `${normal} vs ${slow}`);
});

test('a moving spring near its target has not settled', () => {
    assert.equal(settled({ value: 182.2, velocity: 0 }, 182), true);
    assert.equal(settled({ value: 182.2, velocity: 40 }, 182), false);
    assert.equal(settled({ value: 180, velocity: 0 }, 182), false);
});

test('a long frame does not blow the spring up', () => {
    const state = stepSpring({ value: 32, velocity: 0 }, 182, 1000, springFor('open', 0.5));
    assert.ok(Number.isFinite(state.value));
    assert.ok(state.value > 32 && state.value < 200);
});

test('the corners round more as the notch opens', () => {
    const closed = { height: 32, radius: 14 };
    assert.equal(radiusAt(32, closed), 14);
    assert.equal(radiusAt(20, closed), 14);
    assert.equal(radiusAt(200, closed), 22);
    const half = radiusAt(32 + 30, closed);
    assert.ok(half > 14 && half < 22);
    // A large radius from the settings is kept.
    assert.equal(radiusAt(200, { height: 32, radius: 30 }), 30);
});
