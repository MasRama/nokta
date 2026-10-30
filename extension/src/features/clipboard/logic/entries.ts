import { _, format } from '../../../shared/logic/i18n.js';

/** One copy, as io.nokta.Clipboard1.Items lists it. */
export interface ClipboardEntry {
    id: string;
    kind: 'text' | 'image';
    /** One line of the text, or a picture's `width × height`. */
    preview: string;
    /** A PNG of a picture, or null. */
    thumbnail: string | null;
    pinned: boolean;
    /** When it was last copied, in µs since the Unix epoch. */
    timeUs: number;
}

/** noktad keeps no larger picture, so the extension does not read one. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** The page shows this many rows, then scrolls. */
export const MAX_VISIBLE_ROWS = 5;

const TEXT_TYPES = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain', 'STRING', 'TEXT'];
/** Password managers set this on what they copy, so it stays out of histories. */
const SECRET_HINT = 'x-kde-passwordManagerHint';

/** Entries, newest first; anything malformed is skipped. */
export function entriesFrom(raw: unknown): ClipboardEntry[] {
    if (!Array.isArray(raw)) return [];
    const entries: ClipboardEntry[] = [];
    for (const row of raw) {
        if (!Array.isArray(row) || row.length !== 6) continue;
        const [id, kind, preview, thumbnail, pinned, timeUs] = row as unknown[];
        if (typeof id !== 'string' || (kind !== 'text' && kind !== 'image')) continue;
        if (typeof preview !== 'string' || typeof thumbnail !== 'string') continue;
        if (typeof pinned !== 'boolean' || typeof timeUs !== 'number') continue;
        entries.push({ id, kind, preview, thumbnail: thumbnail || null, pinned, timeUs });
    }
    return entries;
}

/** What to keep of a copy with these mimetypes: text first, else a PNG. */
export function captureKind(mimetypes: readonly string[]): 'text' | 'image' | null {
    if (mimetypes.includes(SECRET_HINT)) return null;
    if (mimetypes.some((type) => TEXT_TYPES.includes(type))) return 'text';
    if (mimetypes.includes('image/png')) return 'image';
    return null;
}

/** How long ago, short: `now`, `5 min`, `2 h`, `3 d`. */
export function ageLabel(nowUs: number, timeUs: number): string {
    const minutes = Math.floor(Math.max(0, nowUs - timeUs) / 60_000_000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return format(_('%d min'), minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return format(_('%d h'), hours);
    return format(_('%d d'), Math.floor(hours / 24));
}

/** Rows the page is tall enough for; one for the note when it is empty. */
export function visibleRows(count: number): number {
    return Math.min(Math.max(count, 1), MAX_VISIBLE_ROWS);
}

/** One row of the page, and the gap between two. */
export const ROW_HEIGHT = 32;
export const ROW_SPACING = 4;

/** The list's height for a history of `count` entries. */
export function listHeight(count: number): number {
    const rows = visibleRows(count);
    return rows * ROW_HEIGHT + (rows - 1) * ROW_SPACING;
}

/** The first row shown after scrolling `step` rows from `offset`. */
export function scrolled(offset: number, step: number, count: number): number {
    return Math.max(0, Math.min(offset + step, count - MAX_VISIBLE_ROWS));
}

/** The search field over the list while searching, and the gap under it. */
export const SEARCH_HEIGHT = 30;
const SEARCH_SPACING = 4;

/** The page's height: the search field while searching, then the list. */
export function pageHeight(count: number, searching: boolean): number {
    return (searching ? SEARCH_HEIGHT + SEARCH_SPACING : 0) + listHeight(count);
}

/** A copy that is one address and nothing else, like `https://…` or `www.…`. */
const ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i;

/** A row's icon: a picture, a link for a copied address, else text. */
export function entryIcon(entry: ClipboardEntry): 'nokta-image' | 'nokta-link' | 'nokta-text' {
    if (entry.kind === 'image') return 'nokta-image';
    return ADDRESS.test(entry.preview.trim()) ? 'nokta-link' : 'nokta-text';
}

/** What a row says, as the search reads it. */
export const entryText = (entry: ClipboardEntry): string =>
    entry.kind === 'image' ? format(_('Picture · %s'), entry.preview) : entry.preview;

/** Lower case without accents, so `CAFÉ` finds `cafe`. */
const fold = (text: string): string =>
    text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();

/** The entries whose text has `query`, in their order; all of them for a blank query. */
export function filterEntries(entries: readonly ClipboardEntry[], query: string): readonly ClipboardEntry[] {
    const wanted = fold(query.trim());
    if (!wanted) return entries;
    return entries.filter((entry) => fold(entryText(entry)).includes(wanted));
}
