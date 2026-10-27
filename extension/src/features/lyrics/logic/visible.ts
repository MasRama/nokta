import { currentLineIndex, type LyricLines } from '../../../shared/logic/lyrics.js';

/** Shown for the intro and for empty lines (instrumental breaks). */
export const BREAK = '♪';

/**
 * The lyric line to show at `positionUs`, or null when the row is hidden:
 * only synced lyrics are shown, and only when show_lyrics is on.
 */
export function visibleLyric(
    status: string,
    lines: LyricLines,
    showLyrics: boolean,
    positionUs: number,
): string | null {
    if (!showLyrics || status !== 'synced' || lines.length === 0) return null;
    const index = currentLineIndex(lines, positionUs);
    const text = index >= 0 ? lines[index][1].trim() : '';
    return text || BREAK;
}
