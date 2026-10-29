import { notchX } from './motion.js';

/** The bottom corners of the open notch round at least this much. */
export const OPEN_RADIUS = 22;
/** Over this many px of growth the corners go from the closed radius to the open one. */
const GROWTH_PX = 60;

/** The bottom corner radius at `height`, from the closed notch's height and radius. */
export function radiusAt(height: number, closed: { height: number; radius: number }): number {
    const open = Math.max(closed.radius, OPEN_RADIUS);
    const t = Math.min(Math.max((height - closed.height) / GROWTH_PX, 0), 1);
    return closed.radius + (open - closed.radius) * t;
}

/** The picture's height, taller than any open view, so it never scales as the notch opens. */
export const PICTURE_HEIGHT = 420;

/** The notch widths the settings give; the picture spans the widest. */
export interface NotchWidths {
    idleWidth: number;
    playingWidth: number;
    expandedWidth: number;
    osdWidth: number;
}

/**
 * Where the picture lies in the shape actor, which is laid out for a body
 * `laidWidth` wide: as wide as the widest notch with its ears, from the top,
 * centred on the monitor like the notch at rest. A narrower notch shows the
 * picture's middle; the picture itself never moves on screen.
 */
export function pictureRect(
    monitor: { x: number; width: number },
    laidWidth: number,
    ear: number,
    widths: NotchWidths,
): { x: number; y: number; width: number; height: number } {
    const width = Math.max(widths.idleWidth, widths.playingWidth, widths.expandedWidth, widths.osdWidth) + 2 * ear;
    const left = notchX(monitor, laidWidth, ear);
    const middle = monitor.x + monitor.width / 2;
    return { x: Math.round(middle - width / 2) - left, y: 0, width, height: PICTURE_HEIGHT };
}
