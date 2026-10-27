/** How much of the track has played, 0..1 (0 when the length is unknown). */
export function fractionOf(positionUs: number, lengthUs: number): number {
    if (lengthUs <= 0) return 0;
    return Math.min(1, Math.max(0, positionUs / lengthUs));
}

/** The track position under the pointer at `x` on a bar `width` wide. */
export function positionAt(x: number, width: number, lengthUs: number): number {
    if (width <= 0) return 0;
    return Math.round(Math.min(1, Math.max(0, x / width)) * lengthUs);
}
