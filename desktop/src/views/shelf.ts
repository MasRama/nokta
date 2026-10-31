import type { ShelfItem } from '@ext/features/shelf/logic/items.js';
import { itemRects, SHELF_ROW_HEIGHT, type SlotRect } from '@ext/features/shelf/logic/layout.js';
import { withAlpha } from '@ext/shared/logic/color.js';
import { _ } from '@ext/shared/logic/i18n.js';

import { icon, setIcon } from '../icons.js';

/** The stack's icon, the badge's and the drop area's. */
export const SHELF_ICON = 'folder-documents';
const FILE_ICON_SIZE = 32;
const STACK_ICON_SIZE = 22;
/** A press that moves this far, in CSS px, drags the files out. */
const DRAG_DISTANCE = 4;

/** What the shelf's row does with a press. */
export interface ShelfHandlers {
    open(uri: string): void;
    remove(uri: string): void;
    clear(): void;
    /** Drags the files out of the notch to Explorer or an app. */
    drag(uris: string[]): void;
}

/**
 * The parked files in one row: the stack (every file, with the count), then
 * the newest files that fit. A click opens a file; each slot's close button
 * takes it off the shelf, or every file for the stack's. Dragging a slot
 * drags its file out, or every file for the stack. As the extension's
 * shelf/row.ts with its helper window's presses.
 */
export class ShelfRow {
    readonly element: HTMLDivElement;
    private items: readonly ShelfItem[] = [];
    /** Where a press on a slot started, and the files it would drag. */
    private press: { x: number; y: number; uris: string[] } | null = null;
    /** The press became a drag: its click opens nothing. */
    private dragged = false;

    constructor(
        private readonly handlers: ShelfHandlers,
        /** A thumbnail's path as a URL the page loads. */
        private readonly url: (path: string) => string,
    ) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-shelf-row';
        this.element.style.height = `${SHELF_ROW_HEIGHT}px`;
        this.element.hidden = true;
        this.element.addEventListener('pointermove', (e) => this.onMove(e));
        this.element.addEventListener('pointerup', () => (this.press = null));
    }

    /** Draws `items` in a row `width` CSS px wide; none hides it. */
    show(items: readonly ShelfItem[], width: number): void {
        this.items = items;
        this.element.hidden = items.length === 0;
        this.element.replaceChildren(...itemRects(items.length, width).map((rect) => this.slot(rect)));
    }

    private slot(rect: SlotRect): HTMLElement {
        const stack = rect.kind === 'stack';
        const item = stack ? null : this.items[rect.index];
        const uris = item ? [item.uri] : this.items.map((i) => i.uri);
        const slot = document.createElement('div');
        slot.className = 'nokta-shelf-slot';
        slot.style.left = `${rect.x}px`;
        slot.style.width = `${rect.width}px`;
        const open = document.createElement('button');
        open.className = 'nokta-button nokta-shelf-open';
        open.title = item ? item.name : _('File shelf');
        open.append(item ? this.file(item) : this.stack());
        open.addEventListener('pointerdown', (e) => {
            this.dragged = false;
            if (e.button === 0) this.press = { x: e.clientX, y: e.clientY, uris };
        });
        open.addEventListener('click', () => {
            if (!this.dragged && item) this.handlers.open(item.uri);
        });
        const close = document.createElement('button');
        close.className = 'nokta-button nokta-shelf-close';
        close.title = stack ? _('Clear shelf') : _('Remove');
        close.append(icon('close', 10));
        close.addEventListener('click', () => {
            if (item) this.handlers.remove(item.uri);
            else this.handlers.clear();
        });
        slot.append(open, close);
        return slot;
    }

    private onMove(e: PointerEvent): void {
        const press = this.press;
        if (!press) return;
        if ((e.buttons & 1) === 0) {
            this.press = null;
            return;
        }
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_DISTANCE) return;
        this.press = null;
        this.dragged = true;
        this.handlers.drag(press.uris);
    }

    private stack(): HTMLElement {
        const box = document.createElement('span');
        box.className = 'nokta-shelf-stack';
        const count = document.createElement('span');
        count.className = 'nokta-shelf-count';
        count.textContent = String(this.items.length);
        box.append(icon(SHELF_ICON, STACK_ICON_SIZE), count);
        return box;
    }

    private file(item: ShelfItem): HTMLElement {
        if (item.thumbnail) {
            const picture = document.createElement('span');
            picture.className = 'nokta-shelf-thumbnail';
            picture.style.backgroundImage = `url("${this.url(item.thumbnail)}")`;
            return picture;
        }
        const glyph = icon(item.icon, FILE_ICON_SIZE);
        // A kind Nokta draws no icon for gets the plain file's.
        if (!glyph.dataset.icon) setIcon(glyph, 'application-x-generic', FILE_ICON_SIZE);
        return glyph;
    }
}

/** The shelf in the closed notch's one spot: its icon and the number of files. */
export class ShelfBadge {
    readonly element: HTMLSpanElement;
    private readonly label: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('span');
        this.element.className = 'nokta-shelf-badge';
        this.label = document.createElement('span');
        this.label.className = 'nokta-shelf-badge-label';
        this.element.append(icon(SHELF_ICON, 14), this.label);
    }

    update(count: number): void {
        this.label.textContent = String(count);
    }
}

/** The open notch while files are dragged over it: a dashed area saying where to drop. */
export class DropView {
    readonly element: HTMLDivElement;
    private readonly area: HTMLDivElement;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-drop';
        this.area = document.createElement('div');
        this.area.className = 'nokta-drop-area';
        const label = document.createElement('span');
        label.className = 'nokta-drop-label';
        label.textContent = _('Drop to keep here');
        this.area.append(icon('folder-download', 22), label);
        this.element.append(this.area);
    }

    setForeground(color: string): void {
        this.area.style.borderColor = withAlpha(color, 0.55);
    }
}
