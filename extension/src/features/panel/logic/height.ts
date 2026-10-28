/** The rows of home, top to bottom. */
export type PanelRow = 'date' | 'event' | 'recording' | 'call' | 'activity' | 'clock' | 'shelf' | 'controls';

/** The date, the toggles and the tiles: this much under the closed notch. */
const BASE_EXTRA = 128;
/** Between two rows, as `.nokta-panel` spacing. */
const SPACING = 10;
const ROW_HEIGHT: Record<Exclude<PanelRow, 'date' | 'controls'>, number> = {
    event: 18,
    recording: 26,
    call: 26,
    activity: 36,
    clock: 26,
    shelf: 44,
};

/** Home's height for its rows, under a closed notch of `closedHeight`. */
export function panelHeight(closedHeight: number, rows: readonly PanelRow[]): number {
    let height = closedHeight + BASE_EXTRA;
    for (const row of rows) {
        if (row !== 'date' && row !== 'controls') height += ROW_HEIGHT[row] + SPACING;
    }
    return height;
}

/** A sub-page's padding, its header row and the gap under it, as `.nokta-subpage` sets them. */
const PAGE_PADDING = 14;
const PAGE_HEADER = 28;

/** A sub-page's height for a body `bodyHeight` tall; its header sits beside the camera, like home's date. */
export function subPageHeight(bodyHeight: number): number {
    return PAGE_PADDING + PAGE_HEADER + SPACING + bodyHeight + PAGE_PADDING;
}
