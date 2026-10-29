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
    DEFAULT_MEDIA,
    DEFAULT_NOTIFICATIONS,
    DEFAULT_CALENDAR,
    DEFAULT_CLIPBOARD,
    DEFAULT_TIMER,
    DEFAULT_WEATHER,
    lyricsFrom,
    mediaFrom,
    notificationsFrom,
    weatherFrom,
    calendarFrom,
    clipboardFrom,
    DEFAULT_HOME,
    homeFrom,
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
        alert_glow: false,
        depth: false,
        gradient: 'across',
        background_end: '#203040',
        follow_system_style: true,
        light_theme: 'glass',
        picture: '~/Pictures/sea.jpg',
        picture_darken: 0.5,
        picture_blur: 12,
        cover_backdrop: true,
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
        alertGlow: false,
        depth: false,
        gradient: 'across',
        backgroundEnd: '#203040',
        followSystemStyle: true,
        lightTheme: 'glass',
        picture: '~/Pictures/sea.jpg',
        pictureDarken: 0.5,
        pictureBlur: 12,
        coverBackdrop: true,
    });
});

test('the custom gradient is flat by default, and an unknown one is flat', () => {
    assert.equal(DEFAULT_APPEARANCE.gradient, 'none');
    assert.equal(DEFAULT_APPEARANCE.backgroundEnd, '#1c1c1e');
    assert.equal(appearanceFrom({ gradient: 'up' }).gradient, 'none');
    assert.equal(appearanceFrom({ background_end: 'blue' }).backgroundEnd, '#1c1c1e');
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

test('fullscreen_alerts_is_one_of_three_values', () => {
    assert.equal(DEFAULT_BEHAVIOR.fullscreenAlerts, 'important');
    assert.equal(behaviorFrom({ fullscreen_alerts: 'all' }).fullscreenAlerts, 'all');
    assert.equal(behaviorFrom({ fullscreen_alerts: 'none' }).fullscreenAlerts, 'none');
    // A value a newer daemon might add, or a wrong type, keeps the default.
    assert.equal(behaviorFrom({ fullscreen_alerts: 'urgent' }).fullscreenAlerts, 'important');
    assert.equal(behaviorFrom({ fullscreen_alerts: true }).fullscreenAlerts, 'important');
});

test('open_on_is_hover_or_click', () => {
    assert.equal(DEFAULT_BEHAVIOR.openOn, 'hover');
    assert.equal(behaviorFrom({ open_on: 'click' }).openOn, 'click');
    assert.equal(behaviorFrom({ open_on: 'press' }).openOn, 'hover');
    assert.equal(behaviorFrom({ open_on: 1 }).openOn, 'hover');
});

test('gestures_are_on_by_default', () => {
    assert.equal(DEFAULT_BEHAVIOR.gestures, true);
    assert.equal(behaviorFrom({ gestures: false }).gestures, false);
    assert.equal(behaviorFrom({ gestures: 'no' }).gestures, true);
});

test('open_shortcut_is_a_free_string', () => {
    assert.equal(DEFAULT_BEHAVIOR.openShortcut, '<Super><Alt>n');
    assert.equal(behaviorFrom({ open_shortcut: '' }).openShortcut, '');
    assert.equal(behaviorFrom({ open_shortcut: '<Control><Alt>space' }).openShortcut, '<Control><Alt>space');
    assert.equal(behaviorFrom({ open_shortcut: false }).openShortcut, '<Super><Alt>n');
});

test('lyrics_table', () => {
    assert.deepEqual(DEFAULT_LYRICS, { enabled: true, romanize: true });
    assert.deepEqual(lyricsFrom({ enabled: false, romanize: false }), { enabled: false, romanize: false });
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
    assert.deepEqual(DEFAULT_ACTIVITIES, { staleMinutes: 30, autoProgress: true });
    assert.deepEqual(activitiesFrom({ stale_minutes: 90, auto_progress: false }), {
        staleMinutes: 90,
        autoProgress: false,
    });
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

test('media settings from table', () => {
    assert.deepEqual(DEFAULT_MEDIA, { realEqualizer: false });
    assert.deepEqual(mediaFrom({ real_equalizer: true }), { realEqualizer: true });
    assert.deepEqual(mediaFrom({ real_equalizer: 'yes' }), DEFAULT_MEDIA);
    assert.deepEqual(mediaFrom(undefined), DEFAULT_MEDIA);
});

test('clipboard settings from table', () => {
    assert.deepEqual(DEFAULT_CLIPBOARD, { enabled: true, maxItems: 25 });
    assert.deepEqual(clipboardFrom({ enabled: false, max_items: 50 }), { enabled: false, maxItems: 50 });
    assert.deepEqual(clipboardFrom({ max_items: 'many' }), DEFAULT_CLIPBOARD);
});

test('home layout from table', () => {
    assert.deepEqual(DEFAULT_HOME, {
        toggles: ['do_not_disturb', 'caffeine', 'dark_style'],
        tiles: ['notifications', 'focus', 'timer', 'clipboard', 'settings'],
    });
    assert.deepEqual(homeFrom({ toggles: ['night_light'], tiles: [] }), { toggles: ['night_light'], tiles: [] });
    // Unknown names and repeats are dropped, the lists cut to their size.
    assert.deepEqual(homeFrom({ toggles: ['wifi', 'caffeine', 'caffeine'] }).toggles, ['caffeine']);
    assert.deepEqual(
        homeFrom({ tiles: ['screenshot', 'settings', 'timer', 'focus', 'clipboard', 'notifications'] }).tiles,
        ['screenshot', 'settings', 'timer', 'focus', 'clipboard'],
    );
    assert.deepEqual(homeFrom({ toggles: 'caffeine', tiles: [3] }), { toggles: DEFAULT_HOME.toggles, tiles: [] });
    assert.notEqual(homeFrom(undefined).tiles, DEFAULT_HOME.tiles);
});

test('calendar settings from table', () => {
    assert.deepEqual(DEFAULT_CALENDAR, { enabled: true, reminderMinutes: 5, agendaSize: 3, countdown: true });
    assert.deepEqual(calendarFrom({ enabled: false, reminder_minutes: 0, agenda_size: 5, countdown: false }), {
        enabled: false,
        reminderMinutes: 0,
        agendaSize: 5,
        countdown: false,
    });
    assert.deepEqual(calendarFrom({ reminder_minutes: 'soon' }), DEFAULT_CALENDAR);
});
