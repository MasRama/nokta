import type { LyricLines } from '../../../shared/logic/lyrics.js';
import { romanize } from './romanize.js';
import { BREAK } from './visible.js';
import { lyricWindow } from './window.js';

/** One line of the full-screen view, with its romanization or null. */
export interface FullLine {
    text: string;
    romanized: string | null;
}

/** The full-screen view's three lines; `index` is the current one's, -1 before the first. */
export interface FullLines {
    index: number;
    previous: FullLine;
    current: FullLine;
    next: FullLine;
}

/** The lines before, at and after `positionUs`; a gap or the intro shows a note. */
export function fullscreenLines(lines: LyricLines, positionUs: number, romanizeOn: boolean): FullLines {
    const { current, rows } = lyricWindow(lines, positionUs, 3);
    const line = (text: string): FullLine => ({ text, romanized: romanizeOn ? romanize(text) : null });
    return { index: current, previous: line(rows[0]), current: line(rows[1] || BREAK), next: line(rows[2]) };
}
