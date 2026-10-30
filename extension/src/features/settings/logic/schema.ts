import {
    activitiesFrom,
    appearanceFrom,
    calendarFrom,
    clipboardFrom,
    downloadsFrom,
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
import { N_ } from '../../../shared/logic/i18n.js';

/**
 * Every row of the settings window, in order. Adding a setting is one line
 * here; the ranges mirror the daemon's validation so the window never offers
 * a value it rejects (the daemon still has the last word).
 */

export type RowKind =
    | { type: 'bool' }
    /** `atLeast` names a key of the same table whose value is the floor, as the daemon checks it. */
    | { type: 'int'; min: number; max: number; step: number; atLeast?: string }
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
    | 'downloads'
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
const int = (min: number, max: number, step = 1, atLeast?: string): RowKind => ({ type: 'int', min, max, step, atLeast });
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

const downloads = (key: string, title: string, kind: RowKind, subtitle?: string): Row => ({
    table: 'downloads',
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
        { value: 'midnight', label: N_('Midnight') },
        { value: 'graphite', label: N_('Graphite') },
        { value: 'glass', label: N_('Glass') },
        { value: 'aurora', label: N_('Aurora') },
        { value: 'paper', label: N_('Paper') },
        { value: 'custom', label: N_('Custom') },
        { value: 'picture', label: N_('Picture') },
    ],
};

/** Widths and the expanded height may not be below the height; the daemon says so. */
/** A width or the open height: never below the notch's height, which the daemon checks. */
const SIZE = int(16, 2000, 1, 'height');

export const SETTINGS_PAGES: readonly Page[] = [
    {
        name: 'appearance',
        title: N_('Appearance'),
        icon: 'applications-graphics-symbolic',
        groups: [
            {
                title: N_('Theme'),
                rows: [
                    appearance('theme', N_('Theme'), THEME_CHOICE),
                    appearance(
                        'follow_system_style',
                        N_('Follow the system style'),
                        bool(),
                        N_('The theme above in dark style, the one below in light style'),
                    ),
                    appearance('light_theme', N_('Theme in light style'), THEME_CHOICE),
                    appearance(
                        'use_album_accent',
                        N_("Use the cover's color"),
                        bool(),
                        N_('Tint the progress bar, equalizer and play button with the album cover'),
                    ),
                    appearance(
                        'cover_backdrop',
                        N_('Cover behind the player'),
                        bool(),
                        N_("The song's cover, blurred, fills the open player"),
                    ),
                    appearance(
                        'progress_line',
                        N_('Progress line'),
                        bool(),
                        N_('Along the closed notch: the focus timer, a countdown, an activity or the song'),
                    ),
                    appearance(
                        'alert_glow',
                        N_('Glow on alerts'),
                        bool(),
                        N_('Under the notch: red when urgent, green when done or charging'),
                    ),
                    appearance(
                        'alert_motion',
                        N_('Alert motion'),
                        bool(),
                        N_('A timer rings, a failed activity shakes, a charger fills the battery'),
                    ),
                    appearance(
                        'depth',
                        N_('Depth'),
                        bool(),
                        N_('A soft shadow under the notch and a light rim along its edge'),
                    ),
                ],
            },
            {
                title: N_('Picture'),
                rows: [
                    appearance('picture', N_('Picture'), { type: 'file' }, N_('The image the picture theme shows')),
                    appearance(
                        'picture_darken',
                        N_('Darken'),
                        { type: 'float', min: 0, max: 0.8, step: 0.05, percent: true },
                        N_('Keeps the text readable on a bright picture'),
                    ),
                    appearance('picture_blur', N_('Blur'), int(0, 40), N_('Pixels')),
                ],
            },
            {
                title: N_('Custom theme colors'),
                rows: [
                    appearance('background', N_('Background'), color()),
                    appearance(
                        'background_opacity',
                        N_('Background opacity'),
                        { type: 'float', min: 0, max: 1, step: 0.05, percent: true },
                        N_('Text and icons stay solid'),
                    ),
                    appearance(
                        'gradient',
                        N_('Gradient'),
                        {
                            type: 'choice',
                            options: [
                                { value: 'none', label: N_('None') },
                                { value: 'down', label: N_('Downward') },
                                { value: 'across', label: N_('Across') },
                                { value: 'diagonal', label: N_('Diagonal') },
                            ],
                        },
                        N_('From the background to the second color'),
                    ),
                    appearance('background_end', N_('Second color'), color()),
                    appearance('foreground', N_('Text and icons'), color()),
                    appearance('accent', N_('Accent'), color(), N_('Progress bar, equalizer and the volume bar')),
                ],
            },
            {
                title: N_('Size'),
                rows: [
                    appearance('height', N_('Height'), int(16, 96), N_('Pixels; the top bar is 28')),
                    appearance('idle_width', N_('Width when idle'), SIZE),
                    appearance('playing_width', N_('Width while playing'), SIZE),
                    appearance('expanded_width', N_('Expanded width'), SIZE),
                    appearance('expanded_height', N_('Expanded height'), SIZE),
                    appearance('osd_width', N_('Width for volume and brightness'), SIZE),
                ],
            },
            {
                title: N_('Shape'),
                rows: [
                    appearance('corner_radius', N_('Corner radius'), int(0, 64)),
                    appearance('ear_radius', N_('Ear radius'), int(0, 64), N_('The curves where the notch meets the top edge')),
                ],
            },
            {
                title: N_('Motion'),
                rows: [
                    appearance(
                        'animation_speed',
                        N_('Animation duration'),
                        { type: 'float', min: 0.1, max: 5, step: 0.1 },
                        N_('0.5 is twice as fast, 2.0 twice as slow'),
                    ),
                    appearance(
                        'morph',
                        N_('Morph between views'),
                        bool(),
                        N_('The cover flies into the player and rows come in one by one'),
                    ),
                ],
            },
        ],
    },
    {
        name: 'behavior',
        title: N_('Behavior'),
        icon: 'preferences-system-symbolic',
        groups: [
            {
                title: N_('Notch'),
                rows: [
                    behavior('all_monitors', N_('On every monitor'), bool(), N_('Off shows it on the primary monitor only')),
                    behavior(
                        'fullscreen_alerts',
                        N_('Over fullscreen apps'),
                        {
                            type: 'choice',
                            options: [
                                { value: 'important', label: N_('Important alerts') },
                                { value: 'all', label: N_('All alerts') },
                                { value: 'none', label: N_('Nothing') },
                            ],
                        },
                        N_('Important: low battery, the focus timer, timers, alarms and reminders'),
                    ),
                    behavior(
                        'open_on',
                        N_('Open on'),
                        {
                            type: 'choice',
                            options: [
                                { value: 'hover', label: N_('Hover') },
                                { value: 'click', label: N_('Click') },
                            ],
                        },
                        N_('Click: resting the pointer on the notch does not open it'),
                    ),
                    behavior('open_delay_ms', N_('Open delay'), int(0, 5000, 10), N_('Milliseconds of hover before it opens')),
                    behavior(
                        'close_delay_ms',
                        N_('Close delay'),
                        int(0, 5000, 10),
                        N_('Milliseconds after the pointer leaves'),
                    ),
                    behavior(
                        'open_shortcut',
                        N_('Shortcut'),
                        text(),
                        N_('Opens the notch for the keyboard, like <Super><Alt>n; empty for none'),
                    ),
                    behavior(
                        'gestures',
                        N_('Gestures'),
                        bool(),
                        N_('Scroll for volume, swipe sideways for the next song, middle click to play or pause'),
                    ),
                    behavior(
                        'track_peek',
                        N_('Show a new song'),
                        bool(),
                        N_('The closed notch shows its title and artist for a moment'),
                    ),
                ],
            },
            {
                title: N_('Clock'),
                rows: [
                    behavior('show_clock', N_('Show the clock'), bool(), N_('The time in the notch while nothing plays')),
                    behavior('clock_format', N_('Format'), {
                        type: 'choice',
                        options: [
                            { value: 'system', label: N_('Follow GNOME') },
                            { value: '24h', label: N_('24-hour') },
                            { value: '12h', label: N_('12-hour') },
                        ],
                    }),
                    behavior('move_clock', N_("Move GNOME's clock to the right"), bool()),
                ],
            },
            {
                title: N_('Weather'),
                rows: [
                    weather('enabled', N_('Show the weather'), bool(), N_('Next to the date when the notch opens')),
                    weather(
                        'location',
                        N_('Location'),
                        text(),
                        N_('A city like Jakarta, or coordinates like -6.2,106.8; asks open-meteo.com'),
                    ),
                    weather('units', N_('Units'), {
                        type: 'choice',
                        options: [
                            { value: 'celsius', label: N_('Celsius') },
                            { value: 'fahrenheit', label: N_('Fahrenheit') },
                        ],
                    }),
                ],
            },
            {
                title: N_('Calendar'),
                rows: [
                    calendar('enabled', N_('Show events'), bool(), N_("From GNOME's calendar, when the notch opens")),
                    calendar('reminder_minutes', N_('Remind before'), int(0, 60), N_('Minutes before it starts; 0 for no reminder')),
                    calendar('agenda_size', N_('Events in home'), int(1, 5), N_('Today first, then tomorrow')),
                    calendar(
                        'countdown',
                        N_('Count down to the start'),
                        bool(),
                        N_('From the reminder, the closed notch shows the minutes left'),
                    ),
                ],
            },
            {
                title: N_('Clipboard'),
                rows: [
                    clipboard('enabled', N_('Keep a clipboard history'), bool(), N_('Text and pictures you copy, in memory only')),
                    clipboard('max_items', N_('Entries to keep'), int(5, 100), N_('Besides the pinned ones')),
                ],
            },
            {
                title: N_('Music'),
                rows: [
                    behavior('show_lyrics', N_('Show lyrics'), bool()),
                    {
                        table: 'lyrics',
                        key: 'enabled',
                        title: N_('Look up lyrics online'),
                        subtitle: N_('Sends artist, title, album and duration to lrclib.net'),
                        kind: bool(),
                    },
                    {
                        table: 'lyrics',
                        key: 'romanize',
                        title: N_('Romanize lyrics'),
                        subtitle: N_('A line in Latin letters under Korean and Japanese lines'),
                        kind: bool(),
                    },
                    {
                        table: 'media',
                        key: 'real_equalizer',
                        title: N_('Bars that follow the music'),
                        subtitle: N_('Records what plays to measure it; GNOME may show its microphone indicator meanwhile'),
                        kind: bool(),
                    },
                ],
            },
            {
                title: N_('System popups'),
                rows: [
                    behavior('replace_osd', N_('Volume and brightness in the notch'), bool(), N_("Instead of GNOME's popup")),
                    behavior('osd_duration_ms', N_('How long'), int(200, 10000, 100), N_('Milliseconds after the last change')),
                    behavior('show_caps_lock', N_('Caps Lock'), bool()),
                    behavior('show_num_lock', N_('Num Lock'), bool()),
                    behavior('show_input_source', N_('Keyboard layout'), bool(), N_('The new layout when you switch')),
                ],
            },
            {
                title: N_('Notifications'),
                rows: [
                    notifications('in_notch', N_('Notifications in the notch'), bool(), N_("Instead of GNOME's banner")),
                    notifications('duration_ms', N_('How long'), int(1000, 30000, 500), N_('Milliseconds; hovering keeps it open')),
                    notifications('show_body', N_('Show the message'), bool(), N_('Off shows only who sent it and the app')),
                    behavior(
                        'screenshot_preview',
                        N_('Screenshot previews'),
                        bool(),
                        N_('Open a new screenshot, show it in Files or keep it on the shelf'),
                    ),
                ],
            },
            {
                title: N_('Downloads'),
                rows: [
                    downloads(
                        'enabled',
                        N_('Show finished downloads'),
                        bool(),
                        N_('Open the file, show it in Files or keep it on the shelf'),
                    ),
                    downloads('folder', N_('Folder'), text(), N_("Empty for the system's download folder")),
                ],
            },
            {
                title: N_('Live activities'),
                rows: [
                    behavior(
                        'live_activities',
                        N_('Show live activities'),
                        bool(),
                        N_('Builds, downloads and anything run with the nokta command'),
                    ),
                    {
                        table: 'activities',
                        key: 'stale_minutes',
                        title: N_('End after no update for'),
                        subtitle: N_('Minutes'),
                        kind: int(1, 1440),
                    },
                    {
                        table: 'activities',
                        key: 'auto_progress',
                        title: N_('Downloads and updates'),
                        subtitle: N_('Progress that apps show on the dock, and system updates'),
                        kind: bool(),
                    },
                ],
            },
            {
                title: N_('File shelf'),
                rows: [
                    behavior(
                        'file_shelf',
                        N_('Keep files on the notch'),
                        bool(),
                        N_('Drop files on the notch, then drag them out again into any app'),
                    ),
                ],
            },
            {
                title: N_('Device alerts'),
                rows: [
                    behavior('device_alerts', N_('Show device alerts'), bool(), N_('Bluetooth audio, charger and battery')),
                    behavior('alert_duration_ms', N_('How long'), int(500, 15000, 500), N_('Milliseconds')),
                ],
            },
            {
                title: N_('Privacy'),
                rows: [
                    behavior(
                        'privacy_dots',
                        N_('Privacy dots'),
                        bool(),
                        N_('Green while the camera is on, orange while the microphone or screen is used'),
                    ),
                    behavior(
                        'call_indicator',
                        N_('Calls'),
                        bool(),
                        N_('While the microphone is on: the app and how long, with a mute button in home'),
                    ),
                ],
            },
            {
                title: N_('Focus timer'),
                rows: [
                    timer('focus_minutes', N_('Focus length'), int(1, 180), N_('Minutes; start it from Quick Settings')),
                    timer('break_minutes', N_('Break length'), int(0, 60), N_('Minutes after each focus session; 0 for none')),
                    timer('long_break_minutes', N_('Long break length'), int(1, 60), N_('Minutes')),
                    timer(
                        'sessions_before_long_break',
                        N_('Sessions before a long break'),
                        int(0, 12),
                        N_('Focus sessions; 0 for no long breaks'),
                    ),
                    timer('sound', N_('Play a sound'), bool(), N_('When a focus session, a break, a countdown or an alarm ends')),
                    timer('quiet_notifications', N_('Quiet notifications'), bool(), N_('No banners while you focus')),
                    timer('shortcut', N_('Shortcut'), text(), N_('Starts focus or stops the timer, like <Super><Alt>f; empty for none')),
                ],
            },
        ],
    },
    {
        name: 'home',
        title: N_('Home'),
        icon: 'user-home-symbolic',
        groups: [
            {
                title: N_('Quick toggles'),
                description: N_('Up to 3, in this order'),
                rows: [
                    home('toggles', N_('Quick toggles'), {
                        type: 'order',
                        max: MAX_HOME_TOGGLES,
                        options: [
                            { value: 'do_not_disturb', label: N_('Do Not Disturb') },
                            { value: 'caffeine', label: N_('Caffeine') },
                            { value: 'dark_style', label: N_('Dark Style') },
                            { value: 'night_light', label: N_('Night Light') },
                        ],
                    }),
                ],
            },
            {
                title: N_('Tiles'),
                description: N_('Up to 5, in this order'),
                rows: [
                    home('tiles', N_('Tiles'), {
                        type: 'order',
                        max: MAX_HOME_TILES,
                        options: [
                            { value: 'notifications', label: N_('Notifications') },
                            { value: 'focus', label: N_('Focus') },
                            { value: 'timer', label: N_('Timer') },
                            { value: 'clipboard', label: N_('Clipboard') },
                            { value: 'settings', label: N_('Settings') },
                            { value: 'screenshot', label: N_('Screenshot') },
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
    downloads: downloadsFrom,
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

/** The lowest value the row takes now: its own minimum, or the key it must stay at or above. */
export function rowMin(row: Row, tables: Partial<Record<Table, unknown>>): number {
    const { kind } = row;
    if (kind.type !== 'int' && kind.type !== 'float') return 0;
    if (kind.type === 'int' && kind.atLeast) {
        const floor = Number(rowValue({ ...row, key: kind.atLeast }, tables));
        return Math.max(kind.min, floor);
    }
    return kind.min;
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
