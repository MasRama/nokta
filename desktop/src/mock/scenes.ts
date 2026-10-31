import type { Props } from '../bridge/bridge.js';

/** A signal the mock sends once the page is up: `[interface, signal, ...args]`. */
export type SceneSignal = [string, string, ...unknown[]];

/** A state of the browser mock: what the core says, whether the notch opens, and what it is told. */
export interface Scene {
    props: Record<string, Props>;
    open?: boolean;
    signals?: SceneSignal[];
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

/** The scenes `?mock=<name>` shows, for the shots and for working on the page. */
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
    player: { props: player(true) },
    'player-paused': { props: player(false) },
    'player-open': { props: player(true), open: true },
    volume: { props: LINGER, signals: [['Osd1', 'Show', 'volume', 0.62, '']] },
    'caps-lock': { props: LINGER, signals: [['Osd1', 'Show', 'caps-lock', 1, '']] },
    charging: { props: LINGER, signals: [['Devices1', 'Alert', 'charger-plugged', '', 64]] },
    'battery-low': { props: LINGER, signals: [['Devices1', 'Alert', 'battery-critical', '', 8]] },
    call: { props: call(false) },
    'call-muted': { props: call(true) },
    'call-player': { props: { ...player(true), ...call(false) } },
    headphones: { props: { ...player(true), ...LINGER }, signals: [['Devices1', 'Alert', 'bluetooth-connected', 'WH-1000XM5', 80]] },
};

/** The scene for `search` (the page's query string); idle when none or unknown. */
export function sceneFor(search: string): Scene {
    const name = new URLSearchParams(search).get('mock') ?? 'idle';
    return SCENES[name] ?? SCENES.idle;
}
