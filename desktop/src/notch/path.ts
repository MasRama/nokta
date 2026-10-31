/*
 * The notch's outlines as SVG paths: the same silhouette the extension's
 * shader draws (shared/shape.ts). Two ears curve from the top edge into a
 * body whose bottom corners round. x runs right and y down from the top of
 * the window, in CSS px.
 */

/** The notch's width with both ears. */
export function notchWidth(bodyWidth: number, ear: number): number {
    return bodyWidth + 2 * ear;
}

/** A number for a path: two decimals at most, so a size mid-spring stays short. */
function n(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * The outline of a body `width` × `height` with `radius` corners and `ear`
 * ears, the left ear's outer edge at `left`.
 */
export function notchPath(width: number, height: number, radius: number, ear: number, left = 0): string {
    const r = n(Math.max(0, Math.min(radius, width / 2, height)));
    const e = n(ear);
    const bodyLeft = n(left + ear);
    const bodyRight = n(left + ear + width);
    const h = n(height);
    return [
        `M${n(left)},0H${n(left + notchWidth(width, ear))}`,
        `A${e},${e} 0 0 0 ${bodyRight},${e}`,
        `V${n(height - r)}`,
        `A${r},${r} 0 0 1 ${n(bodyRight - r)},${h}`,
        `H${n(bodyLeft + r)}`,
        `A${r},${r} 0 0 1 ${bodyLeft},${n(height - r)}`,
        `V${e}`,
        `A${e},${e} 0 0 0 ${n(left)},0Z`,
    ].join('');
}

/**
 * The body alone, from `left`, grown by `grow` on every side, as the
 * shader's glow and shadow take it. Its top runs off the window, so only
 * the bottom corners round.
 */
export function bodyPath(left: number, width: number, height: number, radius: number, grow: number): string {
    const r = n(Math.max(0, Math.min(radius, width / 2) + grow));
    const x0 = n(left - grow);
    const x1 = n(left + width + grow);
    const bottom = n(height + grow);
    return [
        `M${x0},${-r}H${x1}`,
        `V${n(bottom - r)}`,
        `A${r},${r} 0 0 1 ${n(x1 - r)},${bottom}`,
        `H${n(x0 + r)}`,
        `A${r},${r} 0 0 1 ${x0},${n(bottom - r)}`,
        'Z',
    ].join('');
}

/**
 * Where an SVG gradient on a unit body ends for the palette's `direction`,
 * so its colour at a spot is the shader's: t = (spot · d) / (dx + dy).
 */
export function gradientEnd(direction: [number, number]): [number, number] {
    const [dx, dy] = direction;
    const scale = (dx + dy) / Math.max(dx * dx + dy * dy, 0.001);
    return [dx * scale, dy * scale];
}
