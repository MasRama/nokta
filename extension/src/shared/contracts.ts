/**
 * The TypeScript side of the D-Bus contract (contracts/*.xml, version 1).
 * scripts/check-contracts.mjs fails `npm run check` when a name, type or
 * object path here differs from the XML.
 */

export const BUS_NAME = 'io.nokta.Nokta';
/** The only io.nokta.Nokta1.ApiVersion this extension works with. */
export const API_VERSION = 1;

/** Object path of each interface, keyed by its name without `io.nokta.`. */
export const PATHS = {
    Nokta1: '/io/nokta/Nokta',
    Media1: '/io/nokta/Media',
    Lyrics1: '/io/nokta/Lyrics',
    Settings1: '/io/nokta/Settings',
    Devices1: '/io/nokta/Devices',
} as const;

export interface NoktaProps {
    ApiVersion: number;
    DaemonVersion: string;
}

export interface MediaProps {
    Available: boolean;
    PlayerName: string;
    PlaybackStatus: string;
    Title: string;
    Artists: string[];
    Album: string;
    LengthUs: number;
    ArtPath: string;
    AccentColor: string;
    PositionUs: number;
    PositionTimestampUs: number;
    Rate: number;
    CanPlayPause: boolean;
    CanGoNext: boolean;
    CanGoPrevious: boolean;
    CanSeek: boolean;
}

/** io.nokta.Media1 methods and the D-Bus signature of their arguments. */
export const MEDIA_METHODS = {
    PlayPause: '',
    Next: '',
    Previous: '',
    SetPosition: 'x',
    RefreshPosition: '',
} as const;

export interface LyricsProps {
    Status: string;
    Lines: Array<[number, string]>;
}

export type LyricsStatus =
    | 'none'
    | 'loading'
    | 'synced'
    | 'plain'
    | 'instrumental'
    | 'not-found'
    | 'error';

/** io.nokta.Devices1 signals and the D-Bus signature of their arguments. */
export const DEVICES_SIGNALS = {
    Alert: 'ssi',
} as const;

export interface SettingsProps {
    Appearance: Record<string, unknown>;
    Behavior: Record<string, unknown>;
    Lyrics: Record<string, unknown>;
    Timer: Record<string, unknown>;
}

/** io.nokta.Settings1 methods and the D-Bus signature of their arguments. */
export const SETTINGS_METHODS = {
    Set: 'ssv',
    Reset: '',
} as const;
