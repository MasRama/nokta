import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import type { ShelfItem } from './logic/items.js';
import { CLOSE_SIZE, itemRects, SHELF_ROW_HEIGHT, type Hit, type SlotRect } from './logic/layout.js';

export const SHELF_ICON = 'folder-documents-symbolic';
const FILE_ICON_SIZE = 32;
const STACK_ICON_SIZE = 22;

/**
 * The parked files in one row: the stack (every file, with the count), then
 * the newest files. The helper window lies over it while the pointer is
 * here and takes the presses; setHover() shows what is under the pointer.
 */
export class ShelfRow {
    readonly actor: St.Widget;
    private items: readonly ShelfItem[] = [];
    private hit: Hit | null = null;
    private slots: { rect: SlotRect; actor: St.Widget }[] = [];
    private readonly close: St.Icon;
    /** The width last allocated: `actor.width` reads the wanted width while an allocation is due. */
    private width = 0;
    private laterId = 0;
    /** GNOME 48 and later destroy the actor at shutdown before the extension is disabled. */
    private destroyed = false;

    constructor() {
        this.actor = new St.Widget({
            style_class: 'nokta-shelf-row',
            layout_manager: new Clutter.FixedLayout(),
            x_expand: true,
            height: SHELF_ROW_HEIGHT,
            visible: false,
        });
        this.close = new St.Icon({
            style_class: 'nokta-shelf-close',
            gicon: new Gio.ThemedIcon({ name: 'window-close-symbolic' }),
            width: CLOSE_SIZE,
            height: CLOSE_SIZE,
            visible: false,
        });
        this.actor.connect('destroy', () => {
            this.destroyed = true;
            if (this.laterId) global.compositor.get_laters().remove(this.laterId);
            this.laterId = 0;
        });
        this.actor.connect('notify::allocation', () => {
            const width = Math.round(this.actor.allocation.get_width());
            if (width === this.width) return;
            this.width = width;
            // Not while the stage is laying out: building adds actors.
            if (!this.laterId)
                this.laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                    this.laterId = 0;
                    this.build();
                    return GLib.SOURCE_REMOVE;
                });
        });
    }

    show(items: readonly ShelfItem[]): void {
        this.items = items;
        this.actor.visible = items.length > 0;
        this.build();
    }

    setHover(hit: Hit | null): void {
        this.hit = hit;
        if (!this.destroyed) this.applyHover();
    }

    destroy(): void {
        if (!this.destroyed) this.actor.destroy();
    }

    private build(): void {
        if (this.destroyed) return;
        if (this.close.get_parent()) this.actor.remove_child(this.close);
        this.actor.destroy_all_children();
        this.slots = [];
        for (const rect of itemRects(this.items.length, this.width)) {
            const actor = new St.Widget({
                style_class: 'nokta-shelf-slot',
                layout_manager: new Clutter.BinLayout(),
                x: rect.x,
                y: 0,
                width: rect.width,
                height: SHELF_ROW_HEIGHT,
            });
            actor.add_child(rect.kind === 'stack' ? this.stack() : this.file(this.items[rect.index]));
            this.actor.add_child(actor);
            this.slots.push({ rect, actor });
        }
        this.actor.add_child(this.close);
        this.applyHover();
    }

    private applyHover(): void {
        const hit = this.hit;
        let hovered: SlotRect | null = null;
        for (const { rect, actor } of this.slots) {
            const on = hit?.kind === rect.kind && hit.index === rect.index;
            if (on) hovered = rect;
            if (on) actor.add_style_class_name('nokta-shelf-slot-hover');
            else actor.remove_style_class_name('nokta-shelf-slot-hover');
        }
        this.close.visible = hovered !== null;
        if (!hovered) return;
        this.close.set_position(hovered.x + hovered.width - CLOSE_SIZE, 0);
        if (hit?.close) this.close.add_style_class_name('nokta-shelf-close-hover');
        else this.close.remove_style_class_name('nokta-shelf-close-hover');
    }

    private stack(): St.Widget {
        const box = new St.BoxLayout({
            style_class: 'nokta-shelf-stack',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(
            new St.Icon({
                gicon: new Gio.ThemedIcon({ name: SHELF_ICON }),
                icon_size: STACK_ICON_SIZE,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        box.add_child(
            new St.Label({
                style_class: 'nokta-shelf-count',
                text: String(this.items.length),
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        return box;
    }

    private file(item: ShelfItem): St.Icon {
        return new St.Icon({
            gicon: new Gio.ThemedIcon({ name: item.icon }),
            fallback_icon_name: 'application-x-generic',
            icon_size: FILE_ICON_SIZE,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }
}

/** The shelf in the closed notch's one spot: an icon and the number of files. */
export class ShelfBadge {
    readonly actor: St.BoxLayout;
    private readonly label: St.Label;

    constructor() {
        this.label = new St.Label({ style_class: 'nokta-shelf-badge-label', y_align: Clutter.ActorAlign.CENTER });
        this.actor = new St.BoxLayout({
            style_class: 'nokta-shelf-badge',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(
            new St.Icon({
                style_class: 'nokta-shelf-badge-icon',
                gicon: new Gio.ThemedIcon({ name: SHELF_ICON }),
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        this.actor.add_child(this.label);
    }

    update(count: number): void {
        this.label.text = String(count);
    }

    destroy(): void {
        this.actor.destroy();
    }
}
