/** The rows of the idle panel, top to bottom. */
export type PanelRow = 'date' | 'event' | 'activity' | 'shelf' | 'buttons';

/** The date and the buttons: this much under the closed notch. */
const BASE_EXTRA = 58;
/** Between two rows, as `.nokta-panel` spacing. */
const SPACING = 10;
const ROW_HEIGHT: Record<Exclude<PanelRow, 'date' | 'buttons'>, number> = {
    event: 18,
    activity: 36,
    shelf: 44,
};

/** The open panel's height for its rows, under a closed notch of `closedHeight`. */
export function panelHeight(closedHeight: number, rows: readonly PanelRow[]): number {
    let height = closedHeight + BASE_EXTRA;
    for (const row of rows) {
        if (row !== 'date' && row !== 'buttons') height += ROW_HEIGHT[row] + SPACING;
    }
    return height;
}
