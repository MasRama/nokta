import { formatDuration } from '../../../shared/logic/format.js';
import { _ } from '../../../shared/logic/i18n.js';

/** One version of a track's lyrics on LRCLIB, from `Lyrics1.Search`. */
export interface LyricsVersion {
    id: number;
    title: string;
    artist: string;
    album: string;
    /** 0 when LRCLIB does not know it. */
    durationMs: number;
    synced: boolean;
}

const isRow = (v: unknown): v is [number, string, string, string, number, boolean] =>
    Array.isArray(v) &&
    v.length === 6 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'string' &&
    typeof v[2] === 'string' &&
    typeof v[3] === 'string' &&
    typeof v[4] === 'number' &&
    typeof v[5] === 'boolean';

/** Search's `a(xsssxb)`, unpacked; anything else is left out. */
export function versionsFrom(rows: unknown): LyricsVersion[] {
    if (!Array.isArray(rows)) return [];
    return rows
        .filter(isRow)
        .map(([id, title, artist, album, durationMs, synced]) => ({ id, title, artist, album, durationMs, synced }));
}

/** Who sings it, how long it is when known, and whether it has timing. */
export function versionDetail(version: LyricsVersion): string {
    const parts = [
        version.artist,
        version.durationMs > 0 ? formatDuration(version.durationMs * 1000) : '',
        version.synced ? _('Synced') : _('No timing'),
    ];
    return parts.filter((part) => part !== '').join(' · ');
}
