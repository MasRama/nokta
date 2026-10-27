import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY_SNAPSHOT, snapshotFrom } from '../src/features/media/logic/snapshot.js';
import { fractionOf, positionAt } from '../src/features/media/logic/progress.js';
import { accentFor } from '../src/shared/logic/color.js';

const props: Record<string, unknown> = {
    Available: true,
    PlayerName: 'Fake',
    PlaybackStatus: 'Playing',
    Title: 'Midnight Static',
    Artists: ['A', 'B'],
    Album: 'Night Drive',
    LengthUs: 200_000_000,
    ArtPath: '/tmp/cover.png',
    AccentColor: '#604632',
    PositionUs: 50_000_000,
    PositionTimestampUs: 123,
    Rate: 1,
    CanPlayPause: true,
    CanGoNext: true,
    CanGoPrevious: false,
    CanSeek: true,
};

test('snapshot_from_all_properties', () => {
    const s = snapshotFrom((name) => props[name]);
    assert.deepEqual(s, {
        available: true,
        playerName: 'Fake',
        playbackStatus: 'Playing',
        title: 'Midnight Static',
        artists: ['A', 'B'],
        album: 'Night Drive',
        lengthUs: 200_000_000,
        artPath: '/tmp/cover.png',
        accentColor: '#604632',
        positionUs: 50_000_000,
        positionTimestampUs: 123,
        rate: 1,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: false,
        canSeek: true,
    });
});

test('snapshot_missing_or_wrong_types_are_empty', () => {
    assert.deepEqual(snapshotFrom(() => undefined), EMPTY_SNAPSHOT);
    const s = snapshotFrom((name) => (name === 'Artists' ? ['ok', 3] : name === 'Rate' ? 'fast' : undefined));
    assert.deepEqual(s.artists, ['ok']);
    assert.equal(s.rate, 1);
});

test('accent_uses_album_color_only_when_enabled_and_valid', () => {
    assert.equal(accentFor(true, '#604632', '#ffffff'), '#604632');
    assert.equal(accentFor(false, '#604632', '#ffffff'), '#ffffff');
    assert.equal(accentFor(true, '', '#ffffff'), '#ffffff');
    assert.equal(accentFor(true, 'nope', '#ffffff'), '#ffffff');
});

test('progress_fraction_is_clamped', () => {
    assert.equal(fractionOf(50, 200), 0.25);
    assert.equal(fractionOf(300, 200), 1);
    assert.equal(fractionOf(-5, 200), 0);
    assert.equal(fractionOf(10, 0), 0);
});

test('position_at_pointer_is_clamped_to_the_track', () => {
    assert.equal(positionAt(50, 200, 200_000_000), 50_000_000);
    assert.equal(positionAt(-10, 200, 200_000_000), 0);
    assert.equal(positionAt(250, 200, 200_000_000), 200_000_000);
    assert.equal(positionAt(50, 0, 200_000_000), 0);
});
