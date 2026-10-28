/** The rows of home, top to bottom. */
export type PanelRow =
    | 'date'
    | 'event'
    | 'recording'
    | 'call'
    | 'activity'
    | 'clock'
    | 'shelf'
    | 'toggles'
    | 'tiles';

/** The date's overhang below the closed notch, which it sits in beside the camera, and the padding under the last row. */
const BASE_EXTRA = 15;
/** Between two rows, as `.nokta-panel` spacing. */
const SPACING = 10;
/** Between the toggles and the tiles, as `.nokta-panel-controls` spacing. */
const CONTROLS_SPACING = 12;
const ROW_HEIGHT: Record<Exclude<PanelRow, 'date'>, number> = {
    event: 18,
    recording: 26,
    call: 26,
    activity: 36,
    clock: 26,
    shelf: 44,
    toggles: 32,
    tiles: 59,
};

/** Home's height for its rows, under a closed notch of `closedHeight`. */
export function panelHeight(closedHeight: number, rows: readonly PanelRow[]): number {
    let height = closedHeight + BASE_EXTRA;
    for (const row of rows) {
        if (row !== 'date' && row !== 'tiles') height += ROW_HEIGHT[row] + SPACING;
    }
    // The toggles and the tiles share one row of home.
    if (rows.includes('tiles')) height += ROW_HEIGHT.tiles + (rows.includes('toggles') ? CONTROLS_SPACING : SPACING);
    return height;
}

/** A sub-page's padding, its header row and the gap under it, as `.nokta-subpage` sets them. */
const PAGE_PADDING = 14;
const PAGE_HEADER = 28;

/** A sub-page's height for a body `bodyHeight` tall; its header sits beside the camera, like home's date. */
export function subPageHeight(bodyHeight: number): number {
    return PAGE_PADDING + PAGE_HEADER + SPACING + bodyHeight + PAGE_PADDING;
}
