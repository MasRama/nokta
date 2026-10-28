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
