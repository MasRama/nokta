import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    appearanceFrom,
    behaviorFrom,
    DEFAULT_APPEARANCE,
    DEFAULT_BEHAVIOR,
} from '../src/features/settings/logic/parse.js';

test('appearance_from_full_table', () => {
    const appearance = appearanceFrom({
        height: 30,
        idle_width: 200,
        playing_width: 280,
        expanded_width: 440,
        expanded_height: 160,
        corner_radius: 12,
        ear_radius: 6,
        background: '#101010',
        foreground: '#eeeeee',
        use_album_accent: false,
        animation_speed: 1.5,
    });
    assert.deepEqual(appearance, {
        height: 30,
        idleWidth: 200,
        playingWidth: 280,
        expandedWidth: 440,
        expandedHeight: 160,
        cornerRadius: 12,
        earRadius: 6,
        background: '#101010',
        foreground: '#eeeeee',
        useAlbumAccent: false,
        animationSpeed: 1.5,
    });
});

test('missing_or_wrong_keys_keep_defaults', () => {
    const appearance = appearanceFrom({ height: 'tall', background: 'black', ear_radius: Number.NaN, idle_width: 190 });
    assert.deepEqual(appearance, { ...DEFAULT_APPEARANCE, idleWidth: 190 });
    assert.deepEqual(appearanceFrom(undefined), DEFAULT_APPEARANCE);
    assert.deepEqual(behaviorFrom(null), DEFAULT_BEHAVIOR);
});

test('behavior_from_table_ignores_unknown_keys', () => {
    const behavior = behaviorFrom({ open_delay_ms: 50, move_clock: false, future_key: 1 });
    assert.deepEqual(behavior, { ...DEFAULT_BEHAVIOR, openDelayMs: 50, moveClock: false });
});

test('defaults_are_not_shared', () => {
    const appearance = appearanceFrom({});
    appearance.height = 99;
    assert.equal(DEFAULT_APPEARANCE.height, 32);
});
