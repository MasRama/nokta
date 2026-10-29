import { withAlpha } from '../../../shared/logic/color.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** The open player's cover glows in its own color; softer on a light notch, none without a color. */
export function coverShadow(color: string | null, light: boolean): string {
    if (!color || !HEX.test(color)) return '';
    return `box-shadow: 0 6px 20px ${withAlpha(color, light ? 0.35 : 0.55)};`;
}

/** The closed cover eases to its look over this long, in ms before animation_speed. */
export const COVER_MS = 260;

/** The closed cover at full strength while playing; dimmed to 70 % and a little smaller while paused. */
export function coverLook(playing: boolean): { opacity: number; scale: number } {
    return playing ? { opacity: 255, scale: 1 } : { opacity: 178, scale: 0.9 };
}
