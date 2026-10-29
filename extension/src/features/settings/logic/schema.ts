import {
    activitiesFrom,
    appearanceFrom,
    calendarFrom,
    clipboardFrom,
    behaviorFrom,
    homeFrom,
    lyricsFrom,
    mediaFrom,
    notificationsFrom,
    timerFrom,
    weatherFrom,
    MAX_HOME_TILES,
    MAX_HOME_TOGGLES,
} from './parse.js';
import type { OrderOption } from './order.js';

/**
 * Every row of the settings window, in order. Adding a setting is one line
 * here; the ranges mirror the daemon's validation so the window never offers
 * a value it rejects (the daemon still has the last word).
 */

export type RowKind =
    | { type: 'bool' }
    | { type: 'int'; min: number; max: number; step: number }
    | { type: 'float'; min: number; max: number; step: number; percent?: boolean }
    | { type: 'color' }
    | { type: 'choice'; options: readonly { value: string; label: string }[] }
    | { type: 'text' }
    /** A path chosen in a file dialog, here always an image. */
    | { type: 'file' }
    /** A list of names from `options`, at most `max`, in the order shown. */
    | { type: 'order'; options: readonly OrderOption[]; max: number };

export type Table =
    | 'appearance'
    | 'behavior'
    | 'media'
    | 'lyrics'
    | 'timer'
    | 'notifications'
    | 'activities'
    | 'weather'
    | 'calendar'
    | 'clipboard'
    | 'home';

export interface Row {
    table: Table;
    /** The key in config.toml, snake_case. */
    key: string;
    title: string;
    subtitle?: string;
    kind: RowKind;
}

export interface Group {
    title: string;
    description?: string;
    rows: readonly Row[];
}

export interface Page {
    name: string;
    title: string;
    icon: string;
    groups: readonly Group[];
}

const bool = (): RowKind => ({ type: 'bool' });
const int = (min: number, max: number, step = 1): RowKind => ({ type: 'int', min, max, step });
const color = (): RowKind => ({ type: 'color' });
const text = (): RowKind => ({ type: 'text' });

const appearance = (key: string, title: string, kind: RowKind, subtitle?: string): Row => ({
    table: 'appearance',
    key,
    title,
    kind,
    subtitle,
});
const behavior = (key: string, title: string, kind: RowKind, subtitle?: string): Row => ({
    table: 'behavior',
    key,
    title,
    kind,
    subtitle,
});

const timer = (key: string, title: string, kind: RowKind, subtitle?: string): Row => ({
    table: 'timer',
    key,
    title,
    kind,
    subtitle,
});

const weather = (key: string, title: string, kind: RowKind, subtitle?: string): Row => ({
    table: 'weather',
    key,
    title,
    kind,
    subtitle,
});

const calendar = (key: string, title: string, kind: RowKind, subtitle?: string): Row => ({
    table: 'calendar',
    key,
    title,
    kind,
    subtitle,
});

const clipboard = (key: string, title: string, kind: RowKind, subtitle?: string): Row => ({
    table: 'clipboard',
    key,
    title,
    kind,
    subtitle,
});

const home = (key: string, title: string, kind: RowKind): Row => ({ table: 'home', key, title, kind });

const notifications = (key: string, title: string, kind: RowKind, subtitle?: string): Row => ({
    table: 'notifications',
    key,
    title,
    kind,
    subtitle,
});

const THEME_CHOICE: RowKind = {
    type: 'choice',
    options: [
        { value: 'midnight', label: 'Midnight' },
        { value: 'graphite', label: 'Graphite' },
        { value: 'glass', label: 'Glass' },
        { value: 'aurora', label: 'Aurora' },
        { value: 'paper', label: 'Paper' },
        { value: 'custom', label: 'Custom' },
        { value: 'picture', label: 'Picture' },
    ],
};

/** Widths and the expanded height may not be below the height; the daemon says so. */
const SIZE = int(16, 2000);

export const SETTINGS_PAGES: readonly Page[] = [
    {
        name: 'appearance',
        title: 'Appearance',
        icon: 'applications-graphics-symbolic',
        groups: [
            {
                title: 'Theme',
                rows: [
                    appearance('theme', 'Theme', THEME_CHOICE),
                    appearance(
                        'follow_system_style',
                        'Follow the system style',
                        bool(),
                        'The theme above in dark style, the one below in light style',
                    ),
                    appearance('light_theme', 'Theme in light style', THEME_CHOICE),
                    appearance(
                        'use_album_accent',
                        "Use the cover's color",
                        bool(),
                        'Tint the progress bar, equalizer and play button with the album cover',
                    ),
                    appearance(
                        'cover_backdrop',
                        'Cover behind the player',
                        bool(),
                        "The song's cover, blurred, fills the open player",
                    ),
                    appearance(
                        'progress_line',
                        'Progress line',
                        bool(),
                        'Along the closed notch: the focus timer, a countdown, an activity or the song',
                    ),
                    appearance(
                        'alert_glow',
                        'Glow on alerts',
                        bool(),
                        'Under the notch: red when urgent, green when done or charging',
                    ),
                    appearance(
                        'alert_motion',
                        'Alert motion',
                        bool(),
                        'A timer rings, a failed activity shakes, a charger fills the battery',
                    ),
                    appearance(
                        'depth',
                        'Depth',
                        bool(),
                        'A soft shadow under the notch and a light rim along its edge',
                    ),
                ],
            },
            {
                title: 'Picture',
                rows: [
                    appearance('picture', 'Picture', { type: 'file' }, 'The image the picture theme shows'),
                    appearance(
                        'picture_darken',
                        'Darken',
                        { type: 'float', min: 0, max: 0.8, step: 0.05, percent: true },
                        'Keeps the text readable on a bright picture',
                    ),
                    appearance('picture_blur', 'Blur', int(0, 40), 'Pixels'),
                ],
            },
            {
                title: 'Custom theme colors',
                rows: [
                    appearance('background', 'Background', color()),
                    appearance(
                        'background_opacity',
                        'Background opacity',
                        { type: 'float', min: 0, max: 1, step: 0.05, percent: true },
                        'Text and icons stay solid',
                    ),
                    appearance(
                        'gradient',
                        'Gradient',
                        {
                            type: 'choice',
                            options: [
                                { value: 'none', label: 'None' },
                                { value: 'down', label: 'Downward' },
                                { value: 'across', label: 'Across' },
                                { value: 'diagonal', label: 'Diagonal' },
                            ],
                        },
                        'From the background to the second color',
                    ),
                    appearance('background_end', 'Second color', color()),
                    appearance('foreground', 'Text and icons', color()),
                    appearance('accent', 'Accent', color(), 'Progress bar, equalizer and the volume bar'),
                ],
            },
            {
                title: 'Size',
                rows: [
                    appearance('height', 'Height', int(16, 96), 'Pixels; the top bar is 28'),
                    appearance('idle_width', 'Width when idle', SIZE),
                    appearance('playing_width', 'Width while playing', SIZE),
                    appearance('expanded_width', 'Expanded width', SIZE),
                    appearance('expanded_height', 'Expanded height', SIZE),
                    appearance('osd_width', 'Width for volume and brightness', SIZE),
                ],
            },
            {
                title: 'Shape',
                rows: [
                    appearance('corner_radius', 'Corner radius', int(0, 64)),
                    appearance('ear_radius', 'Ear radius', int(0, 64), 'The curves where the notch meets the top edge'),
                ],
            },
            {
                title: 'Motion',
                rows: [
                    appearance(
                        'animation_speed',
                        'Animation duration',
                        { type: 'float', min: 0.1, max: 5, step: 0.1 },
                        '0.5 is twice as fast, 2.0 twice as slow',
                    ),
                ],
            },
        ],
    },
    {
        name: 'behavior',
        title: 'Behavior',
        icon: 'preferences-system-symbolic',
        groups: [
            {
                title: 'Notch',
                rows: [
                    behavior('all_monitors', 'On every monitor', bool(), 'Off shows it on the primary monitor only'),
                    behavior(
                        'fullscreen_alerts',
                        'Over fullscreen apps',
                        {
                            type: 'choice',
                            options: [
                                { value: 'important', label: 'Important alerts' },
                                { value: 'all', label: 'All alerts' },
                                { value: 'none', label: 'Nothing' },
                            ],
                        },
                        'Important: low battery, the focus timer, timers, alarms and reminders',
                    ),
                    behavior(
                        'open_on',
                        'Open on',
                        {
                            type: 'choice',
                            options: [
                                { value: 'hover', label: 'Hover' },
                                { value: 'click', label: 'Click' },
                            ],
                        },
                        'Click: resting the pointer on the notch does not open it',
                    ),
                    behavior('open_delay_ms', 'Open delay', int(0, 5000, 10), 'Milliseconds of hover before it opens'),
                    behavior(
                        'close_delay_ms',
                        'Close delay',
                        int(0, 5000, 10),
                        'Milliseconds after the pointer leaves',
                    ),
                    behavior(
                        'open_shortcut',
                        'Shortcut',
                        text(),
                        'Opens the notch for the keyboard, like <Super><Alt>n; empty for none',
                    ),
                    behavior(
                        'gestures',
                        'Gestures',
                        bool(),
                        'Scroll for volume, swipe sideways for the next song, middle click to play or pause',
                    ),
                    behavior(
                        'track_peek',
                        'Show a new song',
                        bool(),
                        'The closed notch shows its title and artist for a moment',
                    ),
                ],
            },
            {
                title: 'Clock',
                rows: [
                    behavior('show_clock', 'Show the clock', bool(), 'The time in the notch while nothing plays'),
                    behavior('clock_format', 'Format', {
                        type: 'choice',
                        options: [
                            { value: 'system', label: 'Follow GNOME' },
                            { value: '24h', label: '24-hour' },
                            { value: '12h', label: '12-hour' },
                        ],
                    }),
                    behavior('move_clock', "Move GNOME's clock to the right", bool()),
                ],
            },
            {
                title: 'Weather',
                rows: [
                    weather('enabled', 'Show the weather', bool(), 'Next to the date when the notch opens'),
                    weather(
                        'location',
                        'Location',
                        text(),
                        'A city like Jakarta, or coordinates like -6.2,106.8; asks open-meteo.com',
                    ),
                    weather('units', 'Units', {
                        type: 'choice',
                        options: [
                            { value: 'celsius', label: 'Celsius' },
                            { value: 'fahrenheit', label: 'Fahrenheit' },
                        ],
                    }),
                ],
            },
            {
                title: 'Calendar',
                rows: [
                    calendar('enabled', 'Show events', bool(), "From GNOME's calendar, when the notch opens"),
                    calendar('reminder_minutes', 'Remind before', int(0, 60), 'Minutes before it starts; 0 for no reminder'),
                    calendar('agenda_size', 'Events in home', int(1, 5), 'Today first, then tomorrow'),
                    calendar(
                        'countdown',
                        'Count down to the start',
                        bool(),
                        'From the reminder, the closed notch shows the minutes left',
                    ),
                ],
            },
            {
                title: 'Clipboard',
                rows: [
                    clipboard('enabled', 'Keep a clipboard history', bool(), 'Text and pictures you copy, in memory only'),
                    clipboard('max_items', 'Entries to keep', int(5, 100), 'Besides the pinned ones'),
                ],
            },
            {
                title: 'Music',
                rows: [
                    behavior('show_lyrics', 'Show lyrics', bool()),
                    {
                        table: 'lyrics',
                        key: 'enabled',
                        title: 'Look up lyrics online',
                        subtitle: 'Sends artist, title, album and duration to lrclib.net',
                        kind: bool(),
                    },
                    {
                        table: 'lyrics',
                        key: 'romanize',
                        title: 'Romanize lyrics',
                        subtitle: 'A line in Latin letters under Korean and Japanese lines',
                        kind: bool(),
                    },
                    {
                        table: 'media',
                        key: 'real_equalizer',
                        title: 'Bars that follow the music',
                        subtitle: 'Records what plays to measure it; GNOME may show its microphone indicator meanwhile',
                        kind: bool(),
                    },
                ],
            },
            {
                title: 'System popups',
                rows: [
                    behavior('replace_osd', 'Volume and brightness in the notch', bool(), "Instead of GNOME's popup"),
                    behavior('osd_duration_ms', 'How long', int(200, 10000, 100), 'Milliseconds after the last change'),
                    behavior('show_caps_lock', 'Caps Lock', bool()),
                    behavior('show_num_lock', 'Num Lock', bool()),
                    behavior('show_input_source', 'Keyboard layout', bool(), 'The new layout when you switch'),
                ],
            },
            {
                title: 'Notifications',
                rows: [
                    notifications('in_notch', 'Notifications in the notch', bool(), "Instead of GNOME's banner"),
                    notifications('duration_ms', 'How long', int(1000, 30000, 500), 'Milliseconds; hovering keeps it open'),
                    notifications('show_body', 'Show the message', bool(), 'Off shows only who sent it and the app'),
                    behavior(
                        'screenshot_preview',
                        'Screenshot previews',
                        bool(),
                        'Open a new screenshot, show it in Files or keep it on the shelf',
                    ),
                ],
            },
            {
                title: 'Live activities',
                rows: [
                    behavior(
                        'live_activities',
                        'Show live activities',
                        bool(),
                        'Builds, downloads and anything run with the nokta command',
                    ),
                    {
                        table: 'activities',
                        key: 'stale_minutes',
                        title: 'End after no update for',
                        subtitle: 'Minutes',
                        kind: int(1, 1440),
                    },
                    {
                        table: 'activities',
                        key: 'auto_progress',
                        title: 'Downloads and updates',
                        subtitle: 'Progress that apps show on the dock, and system updates',
                        kind: bool(),
                    },
                ],
            },
            {
                title: 'File shelf',
                rows: [
                    behavior(
                        'file_shelf',
                        'Keep files on the notch',
                        bool(),
                        'Drop files on the notch, then drag them out again into any app',
                    ),
                ],
            },
            {
                title: 'Device alerts',
                rows: [
                    behavior('device_alerts', 'Show device alerts', bool(), 'Bluetooth audio, charger and battery'),
                    behavior('alert_duration_ms', 'How long', int(500, 15000, 500), 'Milliseconds'),
                ],
            },
            {
                title: 'Privacy',
                rows: [
                    behavior(
                        'privacy_dots',
                        'Privacy dots',
                        bool(),
                        'Green while the camera is on, orange while the microphone or screen is used',
                    ),
                    behavior(
                        'call_indicator',
                        'Calls',
                        bool(),
                        'While the microphone is on: the app and how long, with a mute button in home',
                    ),
                ],
            },
            {
                title: 'Focus timer',
                rows: [
                    timer('focus_minutes', 'Focus length', int(1, 180), 'Minutes; start it from Quick Settings'),
                    timer('break_minutes', 'Break length', int(0, 60), 'Minutes after each focus session; 0 for none'),
                    timer('long_break_minutes', 'Long break length', int(1, 60), 'Minutes'),
                    timer(
                        'sessions_before_long_break',
                        'Sessions before a long break',
                        int(0, 12),
                        'Focus sessions; 0 for no long breaks',
                    ),
                    timer('sound', 'Play a sound', bool(), 'When a focus session, a break, a countdown or an alarm ends'),
                    timer('quiet_notifications', 'Quiet notifications', bool(), 'No banners while you focus'),
                    timer('shortcut', 'Shortcut', text(), 'Starts focus or stops the timer, like <Super><Alt>f; empty for none'),
                ],
            },
        ],
    },
    {
        name: 'home',
        title: 'Home',
        icon: 'user-home-symbolic',
        groups: [
            {
                title: 'Quick toggles',
                description: `Up to ${MAX_HOME_TOGGLES}, in this order`,
                rows: [
                    home('toggles', 'Quick toggles', {
                        type: 'order',
                        max: MAX_HOME_TOGGLES,
                        options: [
                            { value: 'do_not_disturb', label: 'Do Not Disturb' },
                            { value: 'caffeine', label: 'Caffeine' },
                            { value: 'dark_style', label: 'Dark Style' },
                            { value: 'night_light', label: 'Night Light' },
                        ],
                    }),
                ],
            },
            {
                title: 'Tiles',
                description: `Up to ${MAX_HOME_TILES}, in this order`,
                rows: [
                    home('tiles', 'Tiles', {
                        type: 'order',
                        max: MAX_HOME_TILES,
                        options: [
                            { value: 'notifications', label: 'Notifications' },
                            { value: 'focus', label: 'Focus' },
                            { value: 'timer', label: 'Timer' },
                            { value: 'clipboard', label: 'Clipboard' },
                            { value: 'settings', label: 'Settings' },
                            { value: 'screenshot', label: 'Screenshot' },
                        ],
                    }),
                ],
            },
        ],
    },
];

const READERS: Record<Table, (raw: unknown) => object> = {
    appearance: appearanceFrom,
    behavior: behaviorFrom,
    media: mediaFrom,
    lyrics: lyricsFrom,
    timer: timerFrom,
    notifications: notificationsFrom,
    activities: activitiesFrom,
    weather: weatherFrom,
    calendar: calendarFrom,
    clipboard: clipboardFrom,
    home: homeFrom,
};

const camelCase = (key: string): string => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * A row's value from the daemon's a{sv} tables, unpacked. A missing or
 * malformed value gives the default, like the notch itself does.
 */
export function rowValue(row: Row, tables: Partial<Record<Table, unknown>>): unknown {
    const values = READERS[row.table](tables[row.table]) as Record<string, unknown>;
    return values[camelCase(row.key)];
}

export const allRows = (): Row[] => SETTINGS_PAGES.flatMap((page) => page.groups.flatMap((group) => group.rows));

/** The GVariant type to send a row's value in, as the daemon publishes it. */
export function variantType(kind: RowKind): 'b' | 'u' | 'd' | 's' | 'as' {
    switch (kind.type) {
        case 'bool':
            return 'b';
        case 'int':
            return 'u';
        case 'float':
            return 'd';
        case 'color':
        case 'choice':
        case 'text':
        case 'file':
            return 's';
        case 'order':
            return 'as';
    }
}
