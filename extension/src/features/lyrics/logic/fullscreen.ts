import { darkenTo, parseHexColor, toHexColor, type Rgb } from '../../../shared/logic/color.js';
import type { LyricLines } from '../../../shared/logic/lyrics.js';
import { romanize } from './romanize.js';
import { BREAK } from './visible.js';
import { lyricWindow } from './window.js';

/** One line of the full-screen view, with its romanization or null. */
export interface FullLine {
    text: string;
    romanized: string | null;
}

/** How many lines the full-screen view shows before and after the current one. */
export const LINES_BEFORE = 2;
export const LINES_AFTER = 3;

/** The full-screen view's lines; `index` is the current one's, -1 before the first. */
export interface FullLines {
    index: number;
    /** The earliest first. */
    before: FullLine[];
    current: FullLine;
    after: FullLine[];
}

/** The lines before, at and after `positionUs`; a gap or the intro shows a note. */
export function fullscreenLines(lines: LyricLines, positionUs: number, romanizeOn: boolean): FullLines {
    // A window centered on the current line, wide enough for the side with more lines.
    const half = Math.max(LINES_BEFORE, LINES_AFTER);
    const { current, rows } = lyricWindow(lines, positionUs, 2 * half + 1);
    const line = (text: string): FullLine => ({ text, romanized: romanizeOn ? romanize(text) : null });
    return {
        index: current,
        before: rows.slice(half - LINES_BEFORE, half).map(line),
        current: line(rows[half] || BREAK),
        after: rows.slice(half + 1, half + 1 + LINES_AFTER).map(line),
    };
}

const OPACITIES = [255, 115, 64, 36];

/** A line's opacity, out of 255, `distance` lines from the current one. */
export function lineOpacity(distance: number): number {
    return OPACITIES[Math.min(Math.abs(distance), OPACITIES.length - 1)];
}

/** The backdrop's color without a cover accent. */
const QUIET = '#4a5a9a';
/** How far the other two colors turn from the accent, in degrees of hue. */
const HUE_TURN = 35;
/** White text stays readable over every color. */
const MAX_LUMINANCE = 0.25;

/** The full-screen backdrop's three colors: the cover's accent and two hues beside it. */
export function blobColors(accent: string): [string, string, string] {
    const base = /^#[0-9a-f]{6}$/i.test(accent) ? accent : QUIET;
    const rgb = parseHexColor(base);
    return [0, HUE_TURN, -HUE_TURN].map((turn) =>
        darkenTo(toHexColor(turnHue(rgb, turn)), MAX_LUMINANCE),
    ) as [string, string, string];
}

/** `rgb` with its hue turned by `degrees`, keeping its lightness and saturation. */
function turnHue({ r, g, b }: Rgb, degrees: number): Rgb {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { r, g, b };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (((h * 60 + degrees) % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r1, g1, b1] =
        h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: r1 + m, g: g1 + m, b: b1 + m };
}
