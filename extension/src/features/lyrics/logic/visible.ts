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

/** What the open player has to show: synced lines, plain text, or nothing. */
export type LyricsKind = 'synced' | 'plain' | null;

export function lyricsKind(status: string, lines: LyricLines, showLyrics: boolean): LyricsKind {
    if (!showLyrics) return null;
    if (status === 'synced' && lines.length > 0) return 'synced';
    if (status === 'plain' && lines.some(([, text]) => text.trim() !== '')) return 'plain';
    return null;
}

/** Lyrics without timing as one text, a line per row. */
export function plainText(lines: LyricLines): string {
    return lines.map(([, text]) => text).join('\n');
}
