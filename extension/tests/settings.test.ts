import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    appearanceFrom,
    behaviorFrom,
    activitiesFrom,
    DEFAULT_ACTIVITIES,
    DEFAULT_APPEARANCE,
    DEFAULT_BEHAVIOR,
    DEFAULT_LYRICS,
    DEFAULT_NOTIFICATIONS,
    DEFAULT_CALENDAR,
    DEFAULT_CLIPBOARD,
    DEFAULT_TIMER,
    DEFAULT_WEATHER,
    lyricsFrom,
    notificationsFrom,
    weatherFrom,
    calendarFrom,
    clipboardFrom,
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
        theme: 'paper',
        progress_line: false,
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
        theme: 'paper',
        progressLine: false,
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
    assert.equal(DEFAULT_BEHAVIOR.privacyDots, true);
    assert.equal(behaviorFrom({ privacy_dots: false }).privacyDots, false);
    assert.equal(DEFAULT_BEHAVIOR.callIndicator, true);
    assert.equal(behaviorFrom({ call_indicator: false }).callIndicator, false);
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
        quietNotifications: true,
        shortcut: '<Super><Alt>f',
    });
    const table = {
        focus_minutes: 50,
        break_minutes: 0,
        long_break_minutes: 30,
        sessions_before_long_break: 0,
        sound: false,
        quiet_notifications: false,
        shortcut: '',
    };
    assert.deepEqual(timerFrom(table), {
        focusMinutes: 50,
        breakMinutes: 0,
        longBreakMinutes: 30,
        sessionsBeforeLongBreak: 0,
        sound: false,
        quietNotifications: false,
        shortcut: '',
    });
    assert.deepEqual(timerFrom(undefined), DEFAULT_TIMER);
});

test('notification_settings_from_table', () => {
    assert.deepEqual(DEFAULT_NOTIFICATIONS, { inNotch: true, durationMs: 5000, showBody: true });
    assert.deepEqual(notificationsFrom({ in_notch: false, duration_ms: 8000, show_body: false }), {
        inNotch: false,
        durationMs: 8000,
        showBody: false,
    });
    assert.deepEqual(notificationsFrom({ duration_ms: 'long' }), DEFAULT_NOTIFICATIONS);
});

test('activity settings from table', () => {
    assert.deepEqual(DEFAULT_ACTIVITIES, { staleMinutes: 30 });
    assert.deepEqual(activitiesFrom({ stale_minutes: 90 }), { staleMinutes: 90 });
    assert.equal(behaviorFrom({}).liveActivities, true);
    assert.equal(behaviorFrom({ live_activities: false }).liveActivities, false);
});

test('the file shelf is on unless turned off', () => {
    assert.equal(behaviorFrom({}).fileShelf, true);
    assert.equal(behaviorFrom({ file_shelf: false }).fileShelf, false);
});

test('the keyboard layout shows by default, Num Lock does not', () => {
    assert.equal(behaviorFrom({}).showInputSource, true);
    assert.equal(behaviorFrom({}).showNumLock, false);
    assert.equal(behaviorFrom({ show_input_source: false, show_num_lock: true }).showInputSource, false);
    assert.equal(behaviorFrom({ show_input_source: false, show_num_lock: true }).showNumLock, true);
});

test('screenshot previews are on unless turned off', () => {
    assert.equal(behaviorFrom({}).screenshotPreview, true);
    assert.equal(behaviorFrom({ screenshot_preview: false }).screenshotPreview, false);
});

test('weather settings from table', () => {
    assert.deepEqual(DEFAULT_WEATHER, { enabled: true, location: '', units: 'celsius' });
    assert.deepEqual(weatherFrom({ enabled: false, location: 'Jakarta', units: 'fahrenheit' }), {
        enabled: false,
        location: 'Jakarta',
        units: 'fahrenheit',
    });
    assert.deepEqual(weatherFrom({ location: 3 }), DEFAULT_WEATHER);
});

test('clipboard settings from table', () => {
    assert.deepEqual(DEFAULT_CLIPBOARD, { enabled: true, maxItems: 25 });
    assert.deepEqual(clipboardFrom({ enabled: false, max_items: 50 }), { enabled: false, maxItems: 50 });
    assert.deepEqual(clipboardFrom({ max_items: 'many' }), DEFAULT_CLIPBOARD);
});

test('calendar settings from table', () => {
    assert.deepEqual(DEFAULT_CALENDAR, { enabled: true, reminderMinutes: 5 });
    assert.deepEqual(calendarFrom({ enabled: false, reminder_minutes: 0 }), { enabled: false, reminderMinutes: 0 });
    assert.deepEqual(calendarFrom({ reminder_minutes: 'soon' }), DEFAULT_CALENDAR);
});
