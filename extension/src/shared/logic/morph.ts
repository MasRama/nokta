/** A box in one coordinate space, in px. */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Where an actor laid at `big`, scaled from its top left corner, has to go
 * and how much it shrinks to cover `at`. Squares, so the width decides.
 */
export function flierTransform(at: Rect, big: Rect): { x: number; y: number; scale: number } {
    return { x: at.x, y: at.y, scale: big.width > 0 ? at.width / big.width : 1 };
}

/** The first row starts this late, after the body has begun to grow. */
const FIRST_ROW_MS = 40;
/** Rows start this far apart, closer when there are many. */
const ROW_STEP_MS = 30;
/** The last row starts no more than this after the first. */
const ROWS_SPAN_MS = 100;

/** When each of `rows` rows starts to come in, from the top. */
export function staggerDelays(rows: number): number[] {
    const step = rows > 1 ? Math.min(ROW_STEP_MS, ROWS_SPAN_MS / (rows - 1)) : 0;
    return Array.from({ length: Math.max(0, rows) }, (_, i) => FIRST_ROW_MS + i * step);
}

/** A row rises `rise` px as it fades in over `ms`, before animation_speed. */
export const ROW_IN = { rise: 6, ms: 180 } as const;

/** What flies between two views: the song's cover, the closed notch's indicator, or nothing. */
export type Flight = 'cover' | 'indicator' | null;

/**
 * What flies when the notch goes from view `from` to view `to`: the cover
 * between the closed notch and the player, the indicator from the idle
 * notch into home. Nothing with `[appearance] morph` or GNOME's animations off.
 */
export function flies(from: string, to: string, s: { morph: boolean; animations: boolean; indicator: boolean }): Flight {
    if (!s.morph || !s.animations) return null;
    if ((from === 'collapsed' && to === 'expanded') || (from === 'expanded' && to === 'collapsed')) return 'cover';
    if (from === 'idle' && to === 'panel' && s.indicator) return 'indicator';
    return null;
}
