import { currentLineIndex, msUntilLine, type LyricLines } from '../../../shared/logic/lyrics.js';

/** The last line has no next one to end it, so it lights up over this long. */
export const LAST_LINE_US = 4_000_000;

/** How far the current line is sung. */
export interface LineProgress {
    /** The current line, or -1 before the first. */
    index: number;
    /** 0 to 1: how much of the line is lit. */
    fraction: number;
    /** Until the line is fully lit, at the playback rate. */
    msLeft: number;
}

const LIT: Omit<LineProgress, 'index'> = { fraction: 1, msLeft: 0 };

/**
 * The current line and how much of it to light, from its start to the next
 * line's. The intro and empty lines (breaks) are lit at once: LRCLIB has no
 * timing for single words, so the fill follows the whole line.
 */
export function lineProgress(lines: LyricLines, positionUs: number, rate: number): LineProgress {
    const index = currentLineIndex(lines, positionUs);
    if (index < 0 || !lines[index][1].trim()) return { index, ...LIT };
    const start = lines[index][0];
    const end = lines[index + 1]?.[0] ?? start + LAST_LINE_US;
    const fraction = Math.min(Math.max((positionUs - start) / (end - start), 0), 1);
    return { index, fraction, msLeft: fraction >= 1 ? 0 : msUntilLine(end, positionUs, rate) };
}

/** The next line with words after the one playing at `positionUs`, or null. */
export function nextLyric(lines: LyricLines, positionUs: number): string | null {
    for (let i = currentLineIndex(lines, positionUs) + 1; i < lines.length; i++) {
        const text = lines[i][1].trim();
        if (text) return text;
    }
    return null;
}
