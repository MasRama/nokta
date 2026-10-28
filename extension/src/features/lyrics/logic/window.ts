import { currentLineIndex, type LyricLines } from '../../../shared/logic/lyrics.js';

/** What the lyrics view shows: `size` rows with the current line in the middle. */
export interface LyricWindow {
    /** Index of the current line in the lyrics, or -1 before the first. */
    current: number;
    /** Empty where the lyrics have no line, before the first and after the last. */
    rows: string[];
}

export function lyricWindow(lines: LyricLines, positionUs: number, size: number): LyricWindow {
    const current = currentLineIndex(lines, positionUs);
    const first = current - Math.floor(size / 2);
    const rows = Array.from({ length: size }, (_, i) => lines[first + i]?.[1] ?? '');
    return { current, rows };
}
