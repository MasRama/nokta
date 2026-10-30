import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attachAll } from '../src/shared/logic/attach.js';

test('every client attaches even when one of them fails, and the failures are named', async () => {
    const attached: string[] = [];
    const broken = new Error('no such interface');
    const failures = await attachAll({
        settings: async () => {
            attached.push('settings');
        },
        shelf: async () => {
            throw broken;
        },
        media: async () => {
            attached.push('media');
        },
    });
    assert.deepEqual(attached.sort(), ['media', 'settings']);
    assert.deepEqual(failures, [{ name: 'shelf', error: broken }]);
});

test('nothing failed gives no failures', async () => {
    assert.deepEqual(await attachAll({ settings: async () => {} }), []);
});
