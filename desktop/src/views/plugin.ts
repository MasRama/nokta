import { PLUGIN_ICON, type PluginCard, type PluginItem } from '@ext/features/plugins/logic/plugins.js';
import { withAlpha } from '@ext/shared/logic/color.js';

import { hasIcon, icon, setIcon } from '../icons.js';
import { IconChip } from './controls.js';

/** Buttons a plugin's row shows at most, as the extension's MAX_PLUGIN_ACTIONS. */
export const MAX_PLUGIN_ACTIONS = 2;
/** Items its page lists at most. */
export const MAX_PLUGIN_ITEMS = 8;
/** An item's row height and the space between rows, as the extension's plugins/page.ts. */
const ITEM_HEIGHT = 36;
const ITEM_SPACING = 4;

/** A plugin's icon, or Nokta's plugin icon for one only GNOME draws. */
const drawable = (name: string): string => (hasIcon(name) ? name : PLUGIN_ICON);

/** The first card with a badge, in the closed notch: its icon in the card's color, then the badge. */
export class PluginBadge {
    readonly element: HTMLSpanElement;
    private readonly glyph = icon('', 14);
    private readonly label: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('span');
        this.element.className = 'nokta-plugin-badge';
        this.label = document.createElement('span');
        this.label.className = 'nokta-plugin-badge-label';
        this.element.append(this.glyph, this.label);
    }

    update(card: PluginCard): void {
        setIcon(this.glyph, drawable(card.icon), 14);
        this.glyph.style.color = card.color;
        this.label.textContent = card.badge;
    }
}

export interface PluginRowHandlers {
    /** Opens the card's items as a page. */
    openPlugin(id: string): void;
    /** Presses the card's button `index`. */
    pluginAction(id: string, index: number): void;
}

/**
 * A plugin's card in home: its icon on a chip of its tone, the title over
 * the detail and badge, a thin bar for its progress and up to two buttons.
 * A card with items opens them. As the extension's panel/view.ts PluginRow.
 */
export class PluginRow {
    readonly element: HTMLDivElement;
    readonly chip = new IconChip();
    private readonly body: HTMLButtonElement;
    private readonly title: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;
    private readonly badge: HTMLSpanElement;
    private readonly track: HTMLDivElement;
    private readonly fill: HTMLDivElement;
    private readonly buttons: HTMLButtonElement[] = [];
    private card: PluginCard | null = null;

    constructor(handlers: PluginRowHandlers) {
        const span = (className: string): HTMLSpanElement => {
            const element = document.createElement('span');
            element.className = className;
            return element;
        };
        this.title = span('nokta-panel-activity-title');
        this.detail = span('nokta-panel-activity-detail');
        this.badge = span('nokta-panel-plugin-badge');
        const second = document.createElement('div');
        second.className = 'nokta-panel-activity-line';
        second.append(this.detail, this.badge);
        this.fill = document.createElement('div');
        this.fill.className = 'nokta-panel-activity-fill';
        this.track = document.createElement('div');
        this.track.className = 'nokta-panel-activity-track';
        this.track.append(this.fill);
        this.body = document.createElement('button');
        this.body.className = 'nokta-panel-plugin-body';
        this.body.append(this.title, second, this.track);
        this.body.addEventListener('click', () => {
            if (this.card && this.card.items.length > 0) handlers.openPlugin(this.card.id);
        });
        this.element = document.createElement('div');
        this.element.className = 'nokta-panel-plugin';
        this.element.hidden = true;
        this.element.append(this.chip.element, this.body);
        for (let i = 0; i < MAX_PLUGIN_ACTIONS; i++) {
            const button = document.createElement('button');
            button.className = 'nokta-button nokta-panel-join';
            button.addEventListener('click', () => {
                if (this.card) handlers.pluginAction(this.card.id, i);
            });
            this.buttons.push(button);
            this.element.append(button);
        }
    }

    show(card: PluginCard | undefined): void {
        this.card = card ?? null;
        this.element.hidden = card === undefined;
        if (!card) return;
        this.chip.show(drawable(card.icon), card.color);
        this.title.textContent = card.title;
        this.detail.textContent = card.detail;
        this.badge.textContent = card.badge;
        this.badge.hidden = card.badge === '';
        this.body.disabled = card.items.length === 0;
        this.track.hidden = card.progress === null;
        this.track.style.backgroundColor = withAlpha(card.color, 0.25);
        this.fill.style.backgroundColor = card.color;
        this.fill.style.transform = `scaleX(${card.progress ?? 0})`;
        this.buttons.forEach((button, i) => {
            const action = card.actions[i];
            button.hidden = action === undefined;
            if (!action) return;
            button.textContent = action.label;
            button.style.backgroundColor = withAlpha(card.color, 0.22);
            button.style.color = card.color;
        });
    }
}

/** One item of a plugin's page; it opens its address, when it has one. */
class ItemRow {
    readonly element: HTMLButtonElement;
    private readonly glyph = icon('', 16);
    private readonly title: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;
    private item: PluginItem | null = null;

    constructor(open: (uri: string) => void) {
        this.title = document.createElement('span');
        this.title.className = 'nokta-plugin-item-title';
        this.detail = document.createElement('span');
        this.detail.className = 'nokta-plugin-item-detail';
        const text = document.createElement('span');
        text.className = 'nokta-plugin-item-text';
        text.append(this.title, this.detail);
        this.element = document.createElement('button');
        this.element.className = 'nokta-plugin-item';
        this.element.append(this.glyph, text);
        this.element.addEventListener('click', () => {
            if (this.item?.open) open(this.item.open);
        });
    }

    show(item: PluginItem | undefined, card: PluginCard): void {
        this.item = item ?? null;
        this.element.hidden = item === undefined;
        if (!item) return;
        setIcon(this.glyph, drawable(item.icon || card.icon), 16);
        this.glyph.style.color = card.color;
        this.title.textContent = item.title;
        this.detail.textContent = item.detail;
        this.detail.hidden = item.detail === '';
        this.element.disabled = item.open === '';
    }
}

/** A plugin's items, one row each, as the extension's plugins/page.ts. */
export class PluginPage {
    readonly element: HTMLDivElement;
    private readonly rows: ItemRow[] = [];
    private shown = 0;

    constructor(open: (uri: string) => void) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-plugin-page';
        for (let i = 0; i < MAX_PLUGIN_ITEMS; i++) {
            const row = new ItemRow(open);
            this.rows.push(row);
            this.element.append(row.element);
        }
    }

    /** The body's height for the items shown. */
    get height(): number {
        return this.shown === 0 ? 0 : this.shown * ITEM_HEIGHT + (this.shown - 1) * ITEM_SPACING;
    }

    show(card: PluginCard): void {
        this.shown = Math.min(card.items.length, MAX_PLUGIN_ITEMS);
        this.rows.forEach((row, i) => row.show(card.items[i], card));
    }
}
