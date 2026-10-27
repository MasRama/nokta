import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    appearanceFrom,
    behaviorFrom,
    DEFAULT_APPEARANCE,
    DEFAULT_BEHAVIOR,
    DEFAULT_LYRICS,
    DEFAULT_TIMER,
    lyricsFrom,
    timerFrom,
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
        osd_width: 320,
        background_opacity: 0.5,
        accent: '#ff8800',
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
        osdWidth: 320,
        backgroundOpacity: 0.5,
        accent: '#ff8800',
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

test('behavior_reads_the_osd_keys', () => {
    assert.equal(DEFAULT_BEHAVIOR.replaceOsd, true);
    assert.equal(DEFAULT_BEHAVIOR.osdDurationMs, 1500);
    assert.equal(DEFAULT_BEHAVIOR.showCapsLock, true);
    assert.equal(DEFAULT_BEHAVIOR.allMonitors, true);
    assert.equal(DEFAULT_BEHAVIOR.deviceAlerts, true);
    assert.equal(DEFAULT_BEHAVIOR.alertDurationMs, 3000);
});

test('clock_settings_and_free_strings', () => {
    assert.equal(DEFAULT_BEHAVIOR.showClock, true);
    assert.equal(DEFAULT_BEHAVIOR.clockFormat, 'system');
    assert.equal(behaviorFrom({ clock_format: '24h' }).clockFormat, '24h');
    // Colors still must be #rrggbb; other strings pass through.
    assert.equal(appearanceFrom({ accent: 'orange' }).accent, '#ffffff');
});

test('lyrics_table', () => {
    assert.deepEqual(DEFAULT_LYRICS, { enabled: true });
    assert.deepEqual(lyricsFrom({ enabled: false }), { enabled: false });
    assert.equal(behaviorFrom({ all_monitors: false }).allMonitors, false);
    assert.equal(DEFAULT_APPEARANCE.osdWidth, 300);
    const behavior = behaviorFrom({ replace_osd: false, osd_duration_ms: 900, show_caps_lock: false });
    assert.deepEqual(behavior, { ...DEFAULT_BEHAVIOR, replaceOsd: false, osdDurationMs: 900, showCapsLock: false });
});

test('defaults_are_not_shared', () => {
    const appearance = appearanceFrom({});
    appearance.height = 99;
    assert.equal(DEFAULT_APPEARANCE.height, 32);
});

test('timer_settings_from_table', () => {
    assert.deepEqual(DEFAULT_TIMER, {
        focusMinutes: 25,
        breakMinutes: 5,
        longBreakMinutes: 15,
        sessionsBeforeLongBreak: 4,
        sound: true,
    });
    const table = {
        focus_minutes: 50,
        break_minutes: 0,
        long_break_minutes: 30,
        sessions_before_long_break: 0,
        sound: false,
    };
    assert.deepEqual(timerFrom(table), {
        focusMinutes: 50,
        breakMinutes: 0,
        longBreakMinutes: 30,
        sessionsBeforeLongBreak: 0,
        sound: false,
    });
    assert.deepEqual(timerFrom(undefined), DEFAULT_TIMER);
});
