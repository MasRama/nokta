/**
 * Where the shelf row draws the stack and each file. The notch draws the row
 * and the helper window takes presses over it, so both use these numbers.
 */

/** Each slot: the stack icon or one file. */
export const SLOT_WIDTH = 40;
export const SLOT_GAP = 4;
/** The close button in the top right corner of a slot. */
export const CLOSE_SIZE = 14;
/** The row's height, as the panel's shelf row. */
export const SHELF_ROW_HEIGHT = 44;

export interface SlotRect {
    kind: 'stack' | 'item';
    /** The item's index in Items (oldest first); -1 for the stack. */
    index: number;
    x: number;
    width: number;
}

export interface Hit {
    kind: 'stack' | 'item';
    index: number;
    /** On the close button: takes the file, or every file for the stack, off the shelf. */
    close: boolean;
}

/** The stack first, then the newest files, as many as fit in `width`. */
export function itemRects(count: number, width: number): SlotRect[] {
    if (count <= 0 || width < SLOT_WIDTH) return [];
    const rects: SlotRect[] = [{ kind: 'stack', index: -1, x: 0, width: SLOT_WIDTH }];
    let x = SLOT_WIDTH + SLOT_GAP;
    for (let index = count - 1; index >= 0 && x + SLOT_WIDTH <= width; index--) {
        rects.push({ kind: 'item', index, x, width: SLOT_WIDTH });
        x += SLOT_WIDTH + SLOT_GAP;
    }
    return rects;
}

/** The slot at a point of the row, or null between slots. */
export function itemAt(x: number, y: number, count: number, width: number): Hit | null {
    const rect = itemRects(count, width).find((r) => x >= r.x && x < r.x + r.width);
    if (!rect) return null;
    const close = x >= rect.x + rect.width - CLOSE_SIZE && y >= 0 && y < CLOSE_SIZE;
    return { kind: rect.kind, index: rect.index, close };
}
