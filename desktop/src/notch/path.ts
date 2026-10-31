/*
 * The notch's outline as an SVG path: the same silhouette the extension's
 * shader draws (shared/shape.ts). Two ears curve from the top edge into a
 * body whose bottom corners round. x runs from the left ear's outer edge,
 * y down from the top of the screen.
 */

/** The notch's width with both ears. */
export function notchWidth(bodyWidth: number, ear: number): number {
    return bodyWidth + 2 * ear;
}

/** The outline of a body `width` × `height` with `radius` corners and `ear` ears. */
export function notchPath(width: number, height: number, radius: number, ear: number): string {
    const r = Math.max(0, Math.min(radius, width / 2, height));
    const left = ear;
    const right = ear + width;
    const total = notchWidth(width, ear);
    return [
        `M0,0H${total}`,
        `A${ear},${ear} 0 0 0 ${right},${ear}`,
        `V${height - r}`,
        `A${r},${r} 0 0 1 ${right - r},${height}`,
        `H${left + r}`,
        `A${r},${r} 0 0 1 ${left},${height - r}`,
        `V${ear}`,
        `A${ear},${ear} 0 0 0 0,0Z`,
    ].join('');
}
