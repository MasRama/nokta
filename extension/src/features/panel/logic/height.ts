/** The rows of home, top to bottom. */
export type PanelRow = 'date' | 'event' | 'activity' | 'shelf' | 'controls';

/** The date, the toggles and the tiles: this much under the closed notch. */
const BASE_EXTRA = 128;
/** Between two rows, as `.nokta-panel` spacing. */
const SPACING = 10;
const ROW_HEIGHT: Record<Exclude<PanelRow, 'date' | 'controls'>, number> = {
    event: 18,
    activity: 36,
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
