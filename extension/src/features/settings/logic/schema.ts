import { appearanceFrom, behaviorFrom, lyricsFrom, timerFrom } from './parse.js';

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
    | { type: 'choice'; options: readonly { value: string; label: string }[] };

export type Table = 'appearance' | 'behavior' | 'lyrics' | 'timer';

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

/** Widths and the expanded height may not be below the height; the daemon says so. */
const SIZE = int(16, 2000);

export const SETTINGS_PAGES: readonly Page[] = [
    {
        name: 'appearance',
        title: 'Appearance',
        icon: 'applications-graphics-symbolic',
        groups: [
            {
                title: 'Colors',
                rows: [
                    appearance('background', 'Background', color()),
                    appearance(
                        'background_opacity',
                        'Background opacity',
                        { type: 'float', min: 0, max: 1, step: 0.05, percent: true },
                        'Text and icons stay solid',
                    ),
                    appearance('foreground', 'Text and icons', color()),
                    appearance('accent', 'Accent', color(), 'Progress bar, equalizer and the volume bar'),
                    appearance(
                        'use_album_accent',
                        "Use the cover's color",
                        bool(),
                        'Tint the progress bar and equalizer with the album cover',
                    ),
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
                    behavior('open_delay_ms', 'Open delay', int(0, 5000, 10), 'Milliseconds of hover before it opens'),
                    behavior(
                        'close_delay_ms',
                        'Close delay',
                        int(0, 5000, 10),
                        'Milliseconds after the pointer leaves',
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
                ],
            },
            {
                title: 'System popups',
                rows: [
                    behavior('replace_osd', 'Volume and brightness in the notch', bool(), "Instead of GNOME's popup"),
                    behavior('osd_duration_ms', 'How long', int(200, 10000, 100), 'Milliseconds after the last change'),
                    behavior('show_caps_lock', 'Caps Lock', bool()),
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
                    timer('sound', 'Play a sound', bool(), 'When a focus session or a break ends'),
                ],
            },
        ],
    },
];

const READERS: Record<Table, (raw: unknown) => object> = {
    appearance: appearanceFrom,
    behavior: behaviorFrom,
    lyrics: lyricsFrom,
    timer: timerFrom,
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
export function variantType(kind: RowKind): 'b' | 'u' | 'd' | 's' {
    switch (kind.type) {
        case 'bool':
            return 'b';
        case 'int':
            return 'u';
        case 'float':
            return 'd';
        case 'color':
        case 'choice':
            return 's';
    }
}
