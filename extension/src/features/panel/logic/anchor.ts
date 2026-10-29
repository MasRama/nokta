import type { Indicator } from '../../../shared/logic/indicator.js';
import type { PanelRow } from './height.js';

/** Home's row for each indicator of the closed notch; the focus timer has the focus tile. */
const ROWS: Readonly<Record<Indicator, PanelRow | 'focus-tile'>> = {
    recording: 'recording',
    call: 'call',
    clock: 'clock',
    activity: 'activity',
    meeting: 'event',
    shelf: 'shelf',
    timer: 'focus-tile',
};

/**
 * Where the closed notch's indicator flies when home opens: its row, or
 * the focus tile for the focus timer; null when home does not show it.
 */
export function anchorRow(indicator: Indicator, rows: readonly PanelRow[]): PanelRow | 'focus-tile' | null {
    const row = ROWS[indicator];
    return rows.includes(row === 'focus-tile' ? 'tiles' : row) ? row : null;
}
