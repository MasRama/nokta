import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_UPDATES, updatesFrom } from '../src/features/settings/logic/parse.js';
import { isNewer, updateRow } from '../src/features/updates/logic/update.js';

test('versions compare by their numbers', () => {
    assert.equal(isNewer('0.12.0', '0.11.0'), true);
    assert.equal(isNewer('0.10.0', '0.9.9'), true);
    assert.equal(isNewer('1.0.0', '0.99.99'), true);
    assert.equal(isNewer('0.11.0', '0.11.0'), false);
    assert.equal(isNewer('0.9.10', '0.10.0'), false);
    assert.equal(isNewer('', '0.11.0'), false, 'an unknown version is never newer');
    assert.equal(isNewer('0.12.0', 'unknown'), false);
});

test('a newer release offers the update', () => {
    assert.deepEqual(updateRow('0.12.0', '0.11.0', '0.11.0', false), {
        text: 'Nokta 0.12.0 is available',
        canInstall: true,
    });
});

test('while it installs the button goes away', () => {
    assert.deepEqual(updateRow('0.12.0', '0.11.0', '0.11.0', true), {
        text: 'Nokta 0.12.0 is available',
        canInstall: false,
    });
});

test('a daemon newer than the extension asks for a new login', () => {
    assert.deepEqual(updateRow('', '0.12.0', '0.11.0', false), {
        text: 'Log out and back in to finish updating Nokta',
        canInstall: false,
    });
    // Even when a still newer release is out: the login comes first.
    assert.deepEqual(updateRow('0.13.0', '0.12.0', '0.11.0', false)?.canInstall, false);
});

test('nothing newer shows no row', () => {
    assert.equal(updateRow('', '0.11.0', '0.11.0', false), null);
    assert.equal(updateRow('', '', '0.11.0', false), null, 'no daemon yet');
});

test('update checks are on by default', () => {
    assert.deepEqual(DEFAULT_UPDATES, { check: true });
    assert.deepEqual(updatesFrom({ check: false }), { check: false });
    assert.deepEqual(updatesFrom({ check: 'no' }), DEFAULT_UPDATES);
});
