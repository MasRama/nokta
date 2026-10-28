import { withAlpha } from '../../../shared/logic/color.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** The open player's cover glows in its own color; softer on a light notch, none without a color. */
export function coverShadow(color: string | null, light: boolean): string {
    if (!color || !HEX.test(color)) return '';
    return `box-shadow: 0 6px 20px ${withAlpha(color, light ? 0.35 : 0.55)};`;
}
