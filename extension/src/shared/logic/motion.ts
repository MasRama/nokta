/** Room past the larger end of a resize, for an overshoot or a kick (6 %). */
const SLACK = 0.08;
const SLACK_PX = 2;
/** The refresh rate to assume when the frame clock does not give one. */
const FALLBACK_HZ = 60;
/** A frame this close to a whole number of periods, as a part of one, counts as that many. */
const SNAP = 0.25;

/**
 * The size the body takes while the springs move from `shown` to `target`:
 * both ends with room to spare, so the layout stays still until they settle.
 * It keeps the parity of `target`, so a centred view lands on the same pixel
 * when the body shrinks to `target`.
 */
export function envelope(shown: number, target: number): number {
    const size = Math.ceil(Math.max(shown, target) * (1 + SLACK)) + SLACK_PX;
    return (size - target) % 2 === 0 ? size : size + 1;
}

/**
 * How far to step the springs for a frame that came `measuredMs` after the
 * last one: a whole number of refresh periods, so the jitter of the frame
 * callbacks does not make the motion uneven. Any other frame (a shell that
 * paints faster than its refresh rate) keeps its own time.
 */
export function frameMs(measuredMs: number, refreshHz: number): number {
    const period = 1000 / (refreshHz > 0 ? refreshHz : FALLBACK_HZ);
    const frames = Math.round(measuredMs / period);
    return frames > 0 && Math.abs(measuredMs - frames * period) < SNAP * period ? frames * period : measuredMs;
}

/** Where a child of `size` starts when centred in `space`, on a whole pixel. */
export function centerOffset(space: number, size: number): number {
    return Math.round((space - size) / 2);
}

/** The left edge of the notch (left ear, body, right ear) centred on `monitor`. */
export function notchX(monitor: { x: number; width: number }, bodyWidth: number, ear: number): number {
    return monitor.x + centerOffset(monitor.width, bodyWidth + 2 * ear);
}
