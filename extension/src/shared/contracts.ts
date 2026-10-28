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
    Timer1: '/io/nokta/Timer',
    Activities1: '/io/nokta/Activities',
    Weather1: '/io/nokta/Weather',
} as const;

export interface NoktaProps {
    ApiVersion: number;
    DaemonVersion: string;
}

export interface MediaProps {
    Available: boolean;
    PlayerId: string;
    PlayerName: string;
    Players: Array<[string, string]>;
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
    Shuffle: boolean;
    LoopStatus: string;
    CanShuffle: boolean;
    CanLoop: boolean;
}

/** io.nokta.Media1 methods and the D-Bus signature of their arguments. */
export const MEDIA_METHODS = {
    PlayPause: '',
    Next: '',
    Previous: '',
    SetPosition: 'x',
    RefreshPosition: '',
    SelectPlayer: 's',
    SetShuffle: 'b',
    SetLoopStatus: 's',
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
    Notifications: Record<string, unknown>;
    Activities: Record<string, unknown>;
    Weather: Record<string, unknown>;
}

/** io.nokta.Settings1 methods and the D-Bus signature of their arguments. */
export const SETTINGS_METHODS = {
    Set: 'ssv',
    Reset: '',
} as const;

export interface TimerProps {
    State: string;
    Phase: string;
    DurationUs: number;
    RemainingUs: number;
    TimestampUs: number;
    Sessions: number;
    LongBreak: boolean;
}

/** io.nokta.Timer1 methods and the D-Bus signature of their arguments. */
export const TIMER_METHODS = {
    Start: 's',
    Pause: '',
    Resume: '',
    Stop: '',
} as const;

/** io.nokta.Timer1 signals and the D-Bus signature of their arguments. */
export const TIMER_SIGNALS = {
    Finished: 's',
} as const;

export interface ActivitiesProps {
    /** id, title, detail, icon name, progress (0 to 1, or -1) and start time in monotonic µs. */
    Activities: Array<[string, string, string, string, number, number]>;
}

/** io.nokta.Activities1 methods and the D-Bus signature of their arguments. */
export const ACTIVITIES_METHODS = {
    Set: 'ssssd',
    End: 'sbs',
} as const;

/** io.nokta.Activities1 signals and the D-Bus signature of their arguments. */
export const ACTIVITIES_SIGNALS = {
    Ended: 'ssbsx',
} as const;

export interface WeatherProps {
    Status: string;
    Place: string;
    Temperature: number;
    High: number;
    Low: number;
    Units: string;
    Condition: string;
    IsDay: boolean;
}

/** io.nokta.Weather1 methods and the D-Bus signature of their arguments. */
export const WEATHER_METHODS = {
    Refresh: '',
} as const;
