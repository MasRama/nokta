import type { MediaProps } from '../../../shared/contracts.js';

/** io.nokta.Media1's properties in camelCase. */
export interface MediaSnapshot {
    available: boolean;
    playerName: string;
    playbackStatus: string;
    title: string;
    artists: string[];
    album: string;
    lengthUs: number;
    artPath: string;
    accentColor: string;
    positionUs: number;
    positionTimestampUs: number;
    rate: number;
    canPlayPause: boolean;
    canGoNext: boolean;
    canGoPrevious: boolean;
    canSeek: boolean;
}

export const EMPTY_SNAPSHOT: Readonly<MediaSnapshot> = {
    available: false,
    playerName: '',
    playbackStatus: 'Stopped',
    title: '',
    artists: [],
    album: '',
    lengthUs: 0,
    artPath: '',
    accentColor: '',
    positionUs: 0,
    positionTimestampUs: 0,
    rate: 1,
    canPlayPause: false,
    canGoNext: false,
    canGoPrevious: false,
    canSeek: false,
};

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

/** Builds a snapshot from a property reader; anything missing or mistyped is empty. */
export function snapshotFrom(read: (name: keyof MediaProps) => unknown): MediaSnapshot {
    const d = EMPTY_SNAPSHOT;
    return {
        available: bool(read('Available'), d.available),
        playerName: str(read('PlayerName'), d.playerName),
        playbackStatus: str(read('PlaybackStatus'), d.playbackStatus),
        title: str(read('Title'), d.title),
        artists: strings(read('Artists')),
        album: str(read('Album'), d.album),
        lengthUs: num(read('LengthUs'), d.lengthUs),
        artPath: str(read('ArtPath'), d.artPath),
        accentColor: str(read('AccentColor'), d.accentColor),
        positionUs: num(read('PositionUs'), d.positionUs),
        positionTimestampUs: num(read('PositionTimestampUs'), d.positionTimestampUs),
        rate: num(read('Rate'), d.rate),
        canPlayPause: bool(read('CanPlayPause'), d.canPlayPause),
        canGoNext: bool(read('CanGoNext'), d.canGoNext),
        canGoPrevious: bool(read('CanGoPrevious'), d.canGoPrevious),
        canSeek: bool(read('CanSeek'), d.canSeek),
    };
}
