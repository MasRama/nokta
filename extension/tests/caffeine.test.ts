import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Caffeine } from '../src/features/panel/logic/caffeine.js';

/** GNOME's session manager: each Inhibit waits until the test answers it. */
function fakeSession() {
    const port = {
        pending: [] as Array<{ resolve: (cookie: number) => void; reject: (error: Error) => void }>,
        released: [] as number[],
        inhibit: () =>
            new Promise<number>((resolve, reject) => {
                port.pending.push({ resolve, reject });
            }),
        uninhibit: (cookie: number) => {
            port.released.push(cookie);
            return Promise.resolve();
        },
    };
    return port;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('caffeine holds one inhibitor while on', async () => {
    const port = fakeSession();
    let changes = 0;
    const caffeine = new Caffeine(port, () => changes++);
    caffeine.set(true);
    caffeine.set(true);
    assert.equal(caffeine.on, true);
    assert.equal(port.pending.length, 1);
    port.pending[0].resolve(7);
    await settle();
    caffeine.set(false);
    assert.equal(caffeine.on, false);
    assert.deepEqual(port.released, [7]);
    assert.equal(changes, 2);
});

test('turning it off before the inhibitor arrives releases it', async () => {
    const port = fakeSession();
    const caffeine = new Caffeine(port, () => {});
    caffeine.set(true);
    caffeine.set(false);
    port.pending[0].resolve(3);
    await settle();
    assert.deepEqual(port.released, [3]);
    assert.equal(caffeine.on, false);
});

test('off and on again while waiting keeps the first inhibitor', async () => {
    const port = fakeSession();
    const caffeine = new Caffeine(port, () => {});
    caffeine.set(true);
    caffeine.set(false);
    caffeine.set(true);
    port.pending[0].resolve(4);
    await settle();
    assert.equal(port.pending.length, 1);
    assert.deepEqual(port.released, []);
    caffeine.set(false);
    assert.deepEqual(port.released, [4]);
});

test('a failed inhibit turns caffeine off', async () => {
    const port = fakeSession();
    let changes = 0;
    const caffeine = new Caffeine(port, () => changes++);
    caffeine.set(true);
    port.pending[0].reject(new Error('no session manager'));
    await settle();
    assert.equal(caffeine.on, false);
    assert.equal(changes, 2);
});

test('release drops the inhibitor, also one that arrives late', async () => {
    const held = fakeSession();
    const first = new Caffeine(held, () => {});
    first.set(true);
    held.pending[0].resolve(1);
    await settle();
    first.release();
    assert.deepEqual(held.released, [1]);

    const late = fakeSession();
    const second = new Caffeine(late, () => {});
    second.set(true);
    second.release();
    late.pending[0].resolve(2);
    await settle();
    assert.deepEqual(late.released, [2]);
    second.set(true);
    assert.equal(late.pending.length, 1);
});
