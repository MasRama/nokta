import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { SECONDARY } from '../../shared/dim.js';
import { iconFor } from '../../shared/icons.js';
import type { PluginCard, PluginItem } from './logic/plugins.js';

/** A row of the list, and the gap between two, as `.nokta-plugin-page` sets them. */
const ROW_HEIGHT = 36;
const SPACING = 4;
/** A card lists at most this many, as noktad keeps them. */
const MAX_ITEMS = 8;

/** One item: its icon in the card's tone, title and detail; a link opens on a click. */
class ItemRow {
    readonly actor: St.Button;
    private readonly icon: St.Icon;
    private readonly title: St.Label;
    private readonly detail: St.Label;
    private item: PluginItem | null = null;

    constructor(open: (uri: string) => void) {
        this.icon = new St.Icon({ style_class: 'nokta-plugin-item-icon', y_align: Clutter.ActorAlign.CENTER });
        this.title = new St.Label({ style_class: 'nokta-plugin-item-title' });
        this.detail = new St.Label({ style_class: 'nokta-plugin-item-detail' });
        this.detail.opacity = SECONDARY;
        for (const label of [this.title, this.detail]) label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const text = setVertical(
            new St.BoxLayout({ style_class: 'nokta-plugin-item-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER }),
        );
        text.add_child(this.title);
        text.add_child(this.detail);
        const box = new St.BoxLayout({ style_class: 'nokta-plugin-item-box', x_expand: true });
        box.add_child(this.icon);
        box.add_child(text);
        this.actor = new St.Button({
            style_class: 'nokta-plugin-item',
            child: box,
            height: ROW_HEIGHT,
            x_expand: true,
            visible: false,
        });
        this.actor.connect('clicked', () => {
            if (this.item?.open) open(this.item.open);
        });
    }

    show(item: PluginItem | undefined, card: PluginCard): void {
        this.item = item ?? null;
        this.actor.visible = item !== undefined;
        if (!item) return;
        this.icon.gicon = iconFor(item.icon || card.icon);
        this.icon.style = `color: ${card.color};`;
        this.title.text = item.title;
        this.detail.text = item.detail;
        this.detail.visible = item.detail !== '';
        this.actor.reactive = item.open !== '';
        this.actor.can_focus = item.open !== '';
    }
}

/** The list of a plugin's card, opened from its row in home. */
export class PluginPage {
    readonly actor: St.BoxLayout;
    private readonly rows: ItemRow[] = [];
    private count = 0;

    constructor(open: (uri: string) => void) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-plugin-page', x_expand: true }));
        for (let i = 0; i < MAX_ITEMS; i++) {
            const row = new ItemRow(open);
            this.rows.push(row);
            this.actor.add_child(row.actor);
        }
    }

    /** The list's height for what it shows. */
    get height(): number {
        return this.count === 0 ? ROW_HEIGHT : this.count * ROW_HEIGHT + (this.count - 1) * SPACING;
    }

    show(card: PluginCard): void {
        this.count = Math.min(card.items.length, MAX_ITEMS);
        this.rows.forEach((row, i) => row.show(card.items[i], card));
    }
}
