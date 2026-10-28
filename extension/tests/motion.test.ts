import assert from 'node:assert/strict';
import { test } from 'node:test';

import { centerOffset, envelope, frameMs, notchX } from '../src/shared/logic/motion.js';
import { kickVelocity, springFor, stepSpring, type SpringState } from '../src/shared/logic/spring.js';

test('the envelope holds both ends of a resize and keeps the parity of the target', () => {
    for (const [shown, target] of [
        [182, 360],
        [360, 182],
        [361, 182],
        [182.4, 361],
        [300, 300],
    ]) {
        const size = envelope(shown, target);
        assert.ok(size >= Math.max(shown, target), `${size} for ${shown} -> ${target}`);
        assert.equal(Number.isInteger(size), true);
        assert.equal((size - target) % 2, 0, `${size} has the parity of ${target}`);
    }
});

test('the envelope has room for a kick past a resting width', () => {
    const params = springFor('width', 1);
    let state: SpringState = { value: 300, velocity: kickVelocity(300, params, 0.06) };
    let peak = 300;
    for (let ms = 0; ms < 2000; ms += 16) {
        state = stepSpring(state, 300, 16, params);
        peak = Math.max(peak, state.value);
    }
    assert.ok(envelope(300, 300) >= peak, `${envelope(300, 300)} < ${peak}`);
});

test('a frame step is a whole number of refresh periods', () => {
    assert.equal(frameMs(16, 60), 1000 / 60);
    assert.equal(frameMs(18.2, 60), 1000 / 60);
    assert.equal(frameMs(33, 60), 2000 / 60);
    assert.equal(frameMs(7, 144), 1000 / 144);
    // A missing rate counts as 60 Hz.
    assert.equal(frameMs(16, 0), 1000 / 60);
});

test('frames faster than the refresh rate step by the time they took', () => {
    // A headless shell paints as fast as it can.
    assert.equal(frameMs(2, 60), 2);
    assert.equal(frameMs(5, 60), 5);
    assert.equal(frameMs(10, 60), 10);
    assert.equal(frameMs(25, 60), 25);
});

test('the notch is centred on its monitor, on a whole pixel', () => {
    assert.equal(notchX({ x: 0, width: 1920 }, 200, 10), 850);
    assert.equal(notchX({ x: 1920, width: 1366 }, 201, 10), 1920 + 573);
    assert.equal(centerOffset(200, 100), 50);
    assert.equal(centerOffset(201, 100), 51);
});

test('a view does not move when the body shrinks from its envelope to its size', () => {
    const monitor = { x: 0, width: 1366 };
    const ear = 10;
    for (const [shown, target] of [
        [182, 361],
        [361, 182],
        [200, 300],
        [300, 301],
    ]) {
        const wide = envelope(shown, target);
        for (const view of [182, 299, 300, 361]) {
            const during = notchX(monitor, wide, ear) + ear + centerOffset(wide, view);
            const after = notchX(monitor, target, ear) + ear + centerOffset(target, view);
            assert.equal(during, after, `view ${view} in ${wide} then ${target}`);
        }
    }
});
