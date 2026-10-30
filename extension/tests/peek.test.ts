import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PEEK_MS, shouldPeek, type PeekTrack } from '../src/features/media/logic/peek.js';

const first: PeekTrack = { key: 'a', title: 'Midnight Static', playing: true };
const second: PeekTrack = { key: 'b', title: 'Second Wind', playing: true };
const closed = { enabled: true, drawn: 'collapsed', fullscreen: false };

test('a new song while the notch is closed on the music peeks', () => {
    assert.equal(shouldPeek(first, second, closed), true);
    assert.equal(shouldPeek(first, second, { ...closed, drawn: 'idle' }), true);
    // A second change during a peek starts it again.
    assert.equal(shouldPeek(first, second, { ...closed, drawn: 'peek' }), true);
});

test('no peek on the first snapshot', () => {
    assert.equal(shouldPeek(null, second, closed), false);
});

test('no peek while the notch is open', () => {
    for (const drawn of ['expanded', 'panel', 'page', 'osd', 'notification', 'screenshot', 'download', 'drop'])
        assert.equal(shouldPeek(first, second, { ...closed, drawn }), false, drawn);
});

test('no peek for the same song, a paused one, one without a title, over a fullscreen app or when off', () => {
    assert.equal(shouldPeek(first, { ...first }, closed), false);
    assert.equal(shouldPeek(first, { ...second, playing: false }, closed), false);
    assert.equal(shouldPeek(first, { ...second, title: '' }, closed), false);
    assert.equal(shouldPeek(first, second, { ...closed, fullscreen: true }), false);
    assert.equal(shouldPeek(first, second, { ...closed, enabled: false }), false);
});

test('a peek lasts three seconds', () => {
    assert.equal(PEEK_MS, 3000);
});
