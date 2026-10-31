import type { Props } from '../bridge/bridge.js';

/** A signal the mock sends once the page is up: `[interface, signal, ...args]`. */
export type SceneSignal = [string, string, ...unknown[]];

/** A state of the browser mock: what the core says, whether the notch opens, and what it is told. */
export interface Scene {
    props: Record<string, Props>;
    open?: boolean;
    signals?: SceneSignal[];
    /** Elements clicked once the notch is open, like a home tile. */
    click?: string[];
    /** Property changes after the clicks, in order, like the samples a page watches. */
    changes?: Array<[string, Props]>;
    /** Files are dragged over the notch. */
    drop?: boolean;
    /** The notch is right-clicked at this point of the page. */
    menu?: [number, number];
}

const appearance = (table: Props): Record<string, Props> => ({ Settings1: { Appearance: table } });

/** OSDs and alerts stay up long enough for a shot. */
const LINGER: Record<string, Props> = { Settings1: { Behavior: { osd_duration_ms: 60_000, alert_duration_ms: 60_000 } } };

/** A stand-in cover: what a cover file is in the app, a data URL is in the browser. */
const COVER =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
            '<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/>' +
            '<stop offset="1" stop-color="#6a2c91"/></linearGradient></defs>' +
            '<rect width="64" height="64" fill="url(#g)"/><circle cx="40" cy="26" r="12" fill="#ffd36e"/>' +
            '<path d="M0 50 Q20 34 36 46 T64 42 V64 H0 Z" fill="#2a1240" opacity="0.8"/></svg>',
    );

/** A download stays up long enough for a shot. */
const LINGER_MESSAGE: Record<string, Props> = { Settings1: { Notifications: { duration_ms: 60_000 } } };

/** A stand-in avatar, cropped round in a toast. */
const AVATAR =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#3d7bd9"/>' +
            '<circle cx="32" cy="25" r="12" fill="#f2c9a5"/><path d="M8 64 Q32 30 56 64 Z" fill="#1f3f73"/></svg>',
    );

/** `Notifications1.Posted` from WhatsApp; `id` tells toasts apart. */
const toast = (id: string, title: string, body: string, buttons: string[], icon = AVATAR): [string, string, ...unknown[]] => [
    'Notifications1',
    'Posted',
    id,
    '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App',
    'WhatsApp',
    title,
    body,
    icon,
    icon === AVATAR,
    buttons,
];

/** A song playing in Spotify, two minutes in, with Chrome as a second player. */
function player(playing: boolean): Record<string, Props> {
    return {
        Media1: {
            Available: true,
            PlayerId: 'Spotify.exe',
            PlayerName: 'Spotify',
            Players: [
                ['Spotify.exe', 'Spotify'],
                ['chrome', 'Chrome'],
            ],
            PlaybackStatus: playing ? 'Playing' : 'Paused',
            Title: 'Golden Hour Drive',
            Artists: ['Nadia Sol', 'The Low Lights'],
            Album: 'Westbound',
            LengthUs: 214_000_000,
            ArtPath: COVER,
            AccentColor: '#ff7a59',
            PositionUs: 121_500_000,
            PositionTimestampUs: Date.now() * 1000,
            Rate: 1,
            CanPlayPause: true,
            CanGoNext: true,
            CanGoPrevious: true,
            CanSeek: true,
            Shuffle: true,
            LoopStatus: 'None',
            CanShuffle: true,
            CanLoop: true,
        },
        Lyrics1: {
            Status: 'synced',
            Lines: [
                [118_000_000, 'Windows down and the radio on'],
                [124_000_000, 'Chasing the light till the light is gone'],
                [130_000_000, 'Golden hour, take me home'],
            ],
            OffsetMs: 0,
        },
    };
}

/** Zoom on a call for 12 minutes, with the camera on; `muted` mutes it. */
function call(muted: boolean): Record<string, Props> {
    return {
        Privacy1: {
            Camera: true,
            CameraApp: 'Zoom',
            Microphone: true,
            MicrophoneApp: 'Zoom',
            MicrophoneSinceUs: Date.now() * 1000 - 723_000_000,
            MicrophoneMuted: muted,
        },
    };
}

/** Home with the weather, Caffeine on, and both tiles Windows has. */
const HOME: Record<string, Props> = {
    Weather1: {
        Status: 'ready',
        Units: 'celsius',
        Place: 'Jakarta',
        Temperature: 31,
        High: 33,
        Low: 25,
        Condition: 'partly-cloudy',
        IsDay: true,
    },
    Toggles1: { DarkStyle: true, Caffeine: true },
    Settings1: { Home: { toggles: ['caffeine', 'dark_style'], tiles: ['notifications', 'screenshot'] } },
};

/** A focus session 25 minutes long with 17:42 left, two done before it. */
function focus(): Record<string, Props> {
    return {
        Timer1: {
            State: 'running',
            Phase: 'focus',
            DurationUs: 1_500_000_000,
            RemainingUs: 1_062_000_000,
            TimestampUs: Date.now() * 1000,
            Sessions: 2,
            LongBreak: false,
            Clocks: [],
        },
    };
}

/** A tea countdown, a paused stopwatch and an alarm at 7:30 tomorrow. */
function clocks(): Record<string, Props> {
    const now = Date.now() * 1000;
    const alarm = new Date();
    alarm.setDate(alarm.getDate() + 1);
    alarm.setHours(7, 30, 0, 0);
    return {
        Timer1: {
            State: 'idle',
            Clocks: [
                ['c3', 'countdown', 'Tea', true, 300_000_000, 184_000_000, now, 0],
                ['c2', 'stopwatch', '', false, 0, 754_000_000, now, 0],
                ['c1', 'alarm', 'Wake up', true, 0, alarm.getTime() * 1000 - now, now, alarm.getTime() * 1000],
            ],
        },
    };
}

/** The scenes `?mock=<name>` shows, for the shots and for working on the page. */
/** A build 40 % done, 92 s in, and a sync of unknown progress. */
function activities(): Record<string, Props> {
    const now = Date.now() * 1000;
    return {
        Activities1: {
            Activities: [
                ['build', 'Build', 'cargo build --release', '', 0.4, now - 92_000_000],
                ['sync', 'Sync', 'Photos', 'emblem-synchronizing-symbolic', -1, now - 12_000_000],
            ],
        },
    };
}

/** A newer Nokta on GitHub. */
const UPDATE: Record<string, Props> = {
    Updates1: { Latest: '0.12.0', ReleaseUrl: 'https://github.com/MasRama/nokta/releases/tag/v0.12.0' },
};

/** Home with the timer's tiles. */
const TIMER_HOME: Record<string, Props> = {
    ...HOME,
    Settings1: { Home: { toggles: ['caffeine', 'dark_style'], tiles: ['focus', 'timer', 'notifications', 'screenshot'] } },
};

/** Home with the System tile. */
const SYSTEM_HOME: Record<string, Props> = {
    ...HOME,
    Settings1: { Home: { toggles: ['caffeine', 'dark_style'], tiles: ['focus', 'timer', 'system', 'notifications'] } },
};

/** Five files on the shelf, the newest a picture with its thumbnail. */
const SHELF: Record<string, Props> = {
    Shelf1: {
        Items: [
            ['file:///C:/Users/ren/Documents/notes.txt', 'notes.txt', 'text-x-generic'],
            ['file:///C:/Users/ren/Downloads/setup.zip', 'setup.zip', 'package-x-generic'],
            ['file:///C:/Users/ren/Documents/Budget.xlsx', 'Budget.xlsx', 'x-office-spreadsheet'],
            ['file:///C:/Users/ren/Documents/Quarterly%20report.pdf', 'Quarterly report.pdf', 'x-office-document'],
            ['file:///C:/Users/ren/Pictures/sunset.png', 'sunset.png', 'image-x-generic'],
        ],
        Thumbnails: { 'file:///C:/Users/ren/Pictures/sunset.png': COVER },
    },
};

/** Home with the Clipboard tile, and a history of six copies, the third pinned and a picture. */
function clipboard(): Record<string, Props> {
    const now = Date.now() * 1000;
    const minutes = (m: number) => now - m * 60_000_000;
    return {
        ...HOME,
        Settings1: { Home: { toggles: ['caffeine', 'dark_style'], tiles: ['focus', 'timer', 'clipboard', 'notifications'] } },
        Clipboard1: {
            Items: [
                ['6', 'text', 'https://github.com/MasRama/nokta/releases', '', false, minutes(0)],
                ['5', 'text', 'Meeting moved to 3 pm, same room', '', false, minutes(4)],
                ['4', 'image', '1920 × 1080', COVER, true, minutes(25)],
                ['3', 'text', 'cargo build --release -p nokta-desktop', '', false, minutes(90)],
                ['2', 'text', 'Jl. Sudirman No. 21, Jakarta', '', true, minutes(60 * 26)],
                ['1', 'text', 'ren@example.com', '', false, minutes(60 * 50)],
            ],
            Paused: false,
        },
    };
}

/** A minute of CPU going up and down, 6.4 of 16 GB, no temperature, a download. */
function samples(): Array<[string, Props]> {
    return Array.from({ length: 30 }, (_, i): [string, Props] => {
        const cpu = 0.18 + 0.14 * Math.sin(i / 3) + (i > 22 ? 0.3 : 0);
        return ['System1', { Usage: [cpu, 6.4e9, 16e9, null, 2_400_000, 85_000] }];
    });
}

/** `Calendar1.Events` from a Google Calendar feed: a meeting soon, then the day's other events. */
function agenda(): Record<string, Props> {
    const now = Date.now();
    const at = (minutes: number, length: number, uid: string, title: string, link = '', color = '') => {
        const start = Math.ceil(now / 60_000) * 60_000 + minutes * 60_000;
        return { id: `0\n${uid}\n${start}`, title, start, end: start + length * 60_000, link, color };
    };
    return {
        ...HOME,
        Settings1: {
            ...HOME.Settings1,
            Calendar: { feeds: ['https://calendar.google.com/calendar/ical/x/private-y/basic.ics'] },
        },
        Calendar1: {
            Events: [
                at(4, 30, 'standup', 'Standup produk', 'https://meet.google.com/abc-defg-hij', '#1badf8'),
                at(95, 60, 'review', 'Review desain notch'),
                at(240, 45, 'dentist', 'Dokter gigi', '', '#34c759'),
            ],
        },
    };
}

export const SCENES: Record<string, Scene> = {
    idle: { props: {} },
    home: { props: HOME, open: true },
    'home-light': {
        props: {
            ...HOME,
            Toggles1: { DarkStyle: false, Caffeine: false },
            Settings1: { ...HOME.Settings1, Appearance: { follow_system_style: true, light_theme: 'paper' } },
        },
        open: true,
    },
    glass: { props: appearance({ theme: 'glass' }), open: true },
    paper: { props: appearance({ theme: 'paper' }), open: true },
    aurora: { props: appearance({ theme: 'aurora' }), open: true },
    custom: {
        props: appearance({ theme: 'custom', background: '#1d2b53', gradient: 'diagonal', background_end: '#7e2553' }),
        open: true,
    },
    focus: { props: focus() },
    'focus-player': { props: { ...player(true), ...focus() } },
    clocks: { props: { ...TIMER_HOME, ...clocks() }, open: true },
    'system-page': { props: SYSTEM_HOME, open: true, click: ['[data-tile="system"]'], changes: samples() },
    download: {
        props: LINGER_MESSAGE,
        signals: [['Downloads1', 'Finished', 'file:///C:/Users/ren/Downloads/Quarterly%20report.pdf', 'Quarterly report.pdf', 'x-office-document', 2_400_000, '']],
    },
    'download-photo': {
        props: LINGER_MESSAGE,
        signals: [['Downloads1', 'Finished', 'file:///C:/Users/ren/Downloads/sunset.png', 'sunset.png', 'image-x-generic', 830_000, COVER]],
    },
    screenshot: {
        props: LINGER_MESSAGE,
        signals: [
            [
                'Screenshots1',
                'Taken',
                'file:///C:/Users/ren/Pictures/Screenshots/Screenshot%202026-10-31%20164512.png',
                'Screenshot 2026-10-31 164512.png',
                'image-x-generic',
                412_000,
                COVER,
            ],
        ],
    },
    'calendar-home': { props: agenda(), open: true },
    'calendar-countdown': { props: agenda() },
    notification: {
        props: LINGER_MESSAGE,
        signals: [toast('41', 'Rani', 'Sudah sampai stasiun, nanti kabari ya kalau kamu sudah dekat', ['Reply', 'Mark as read'])],
    },
    'notification-stack': {
        props: LINGER_MESSAGE,
        signals: [toast('41', 'Rani', 'Sudah sampai', [], ''), toast('42', 'Bima', 'Otw 5 menit', [], '')],
    },
    shelf: { props: SHELF },
    'shelf-home': { props: { ...TIMER_HOME, ...SHELF }, open: true },
    'shelf-player': { props: { ...player(true), ...SHELF }, open: true },
    drop: { props: SHELF, drop: true },
    menu: { props: SHELF, menu: [270, 16] },
    'memory-low': { props: LINGER, signals: [['System1', 'MemoryLow', 15.1e9, 16e9, 'chrome']] },
    'clipboard-page': { props: clipboard(), open: true, click: ['[data-tile="clipboard"]'] },
    'clipboard-search': {
        props: clipboard(),
        open: true,
        click: ['[data-tile="clipboard"]', '.nokta-subpage-actions .nokta-clip-button'],
    },
    'clipboard-empty': {
        props: { ...clipboard(), Clipboard1: { Items: [], Paused: true } },
        open: true,
        click: ['[data-tile="clipboard"]'],
    },
    'timer-page': { props: TIMER_HOME, open: true, click: ['[data-tile="timer"]'] },
    'focus-done': { props: { ...LINGER, ...focus() }, signals: [['Timer1', 'Finished', 'focus']] },
    player: { props: player(true) },
    'player-paused': { props: player(false) },
    'player-open': { props: player(true), open: true },
    volume: { props: LINGER, signals: [['Osd1', 'Show', 'volume', 0.62, '']] },
    'caps-lock': { props: LINGER, signals: [['Osd1', 'Show', 'caps-lock', 1, '']] },
    charging: { props: LINGER, signals: [['Devices1', 'Alert', 'charger-plugged', '', 64]] },
    'battery-low': { props: LINGER, signals: [['Devices1', 'Alert', 'battery-critical', '', 8]] },
    call: { props: call(false) },
    'call-muted': { props: call(true) },
    activity: { props: activities() },
    'activity-home': { props: { ...TIMER_HOME, ...activities(), ...UPDATE }, open: true },
    'activity-done': { props: LINGER, signals: [['Activities1', 'Ended', 'build', 'Build', true, '', 65_000_000]] },
    'call-home': { props: { ...TIMER_HOME, ...call(true) }, open: true },
    'call-player': { props: { ...player(true), ...call(false) } },
    headphones: { props: { ...player(true), ...LINGER }, signals: [['Devices1', 'Alert', 'bluetooth-connected', 'WH-1000XM5', 80]] },
};

/** The scene for `search` (the page's query string); idle when none or unknown. */
export function sceneFor(search: string): Scene {
    const name = new URLSearchParams(search).get('mock') ?? 'idle';
    return SCENES[name] ?? SCENES.idle;
}
