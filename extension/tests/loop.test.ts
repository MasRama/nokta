import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loopIcon, nextLoopStatus, shuffleIcon } from '../src/features/media/logic/loop.js';

test('repeat_cycles_none_playlist_track', () => {
    assert.equal(nextLoopStatus('None'), 'Playlist');
    assert.equal(nextLoopStatus('Playlist'), 'Track');
    assert.equal(nextLoopStatus('Track'), 'None');
});

test('repeat_one_has_its_own_icon_and_off_is_dimmed', () => {
    assert.deepEqual(loopIcon('None'), { icon: 'media-playlist-repeat-symbolic', on: false });
    assert.deepEqual(loopIcon('Playlist'), { icon: 'media-playlist-repeat-symbolic', on: true });
    assert.deepEqual(loopIcon('Track'), { icon: 'media-playlist-repeat-song-symbolic', on: true });
});

test('shuffle_icon_is_dimmed_when_off', () => {
    assert.deepEqual(shuffleIcon(true), { icon: 'media-playlist-shuffle-symbolic', on: true });
    assert.deepEqual(shuffleIcon(false), { icon: 'media-playlist-shuffle-symbolic', on: false });
});
