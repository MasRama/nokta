import type Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ShelfHelper } from './helper.js';
import { pointIn, type Rect } from './logic/items.js';
import type { Hit } from './logic/layout.js';
import type { HelperEvent } from './logic/protocol.js';
import { PassThrough } from './passthrough.js';

/** The pointer should reach the helper soon after it is placed under it. */
const ENTER_TIMEOUT_MS = 500;
/** A drag out of the helper starts with the pointer leaving it; wait for the drag to say so. */
const LEAVE_GRACE_MS = 150;
/** After this many placements the pointer never reached, the row stops using the helper. */
const MAX_MISSED_ENTERS = 3;

/** What the shelf needs from a monitor's notch. */
export interface ShelfNotch {
    /** The notch's root actor, which lets the pointer through while the helper lies under it. */
    readonly chrome: Clutter.Actor;
    /** The closed notch and a margin around it: files dragged here open the drop area. */
    dropTrigger(): Rect;
    /** The open drop area, in stage coordinates. */
    dropRect(): Rect;
    setDropping(on: boolean): void;
    /** The pointer is over the helper lying on this notch's shelf row. */
    setHelperPointer(inside: boolean): void;
    setShelfHover(hit: Hit | null): void;
}

/**
 * Moves the helper window where it is needed: over the drop area while
 * files are dragged to a notch, and over a shelf row while the pointer is
 * on it. The notch's actors (and the top bar, for a drop) let the pointer
 * through meanwhile. destroy() undoes everything.
 */
export class ShelfCoordinator {
    private helper: ShelfHelper | null = null;
    private readonly passThrough = new PassThrough();
    private dndIds: number[] = [];
    private rowNotch: ShelfNotch | null = null;
    private dropNotch: ShelfNotch | null = null;
    private inside = false;
    private ownDrag = false;
    private externalDrag = false;
    private enterTimeoutId = 0;
    private leaveTimeoutId = 0;
    private missedEnters = 0;

    constructor(
        private readonly script: string,
        private readonly notches: () => readonly ShelfNotch[],
    ) {}

    setEnabled(on: boolean): void {
        if (on && !this.helper) this.start();
        else if (!on && this.helper) this.stop();
    }

    /** The pointer is over `notch`'s shelf row, drawn at `rect`. */
    overRow(notch: ShelfNotch, rect: Rect): void {
        if (!this.helper || this.externalDrag || this.rowNotch || this.missedEnters >= MAX_MISSED_ENTERS) return;
        this.rowNotch = notch;
        this.helper.place(rect);
        this.passThrough.set([notch.chrome]);
        this.enterTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ENTER_TIMEOUT_MS, () => {
            this.enterTimeoutId = 0;
            this.missedEnters++;
            if (this.missedEnters === MAX_MISSED_ENTERS)
                console.warn('Nokta: the pointer never reaches the file shelf helper; dragging files out is off');
            this.releaseRow();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** `notch` no longer shows its shelf row. */
    rowGone(notch: ShelfNotch): void {
        if (this.rowNotch === notch && !this.ownDrag) this.releaseRow();
    }

    /** `notch` is about to be destroyed. */
    forget(notch: ShelfNotch): void {
        if (this.rowNotch === notch) this.releaseRow();
        if (this.dropNotch === notch) this.endDrop();
    }

    destroy(): void {
        this.stop();
    }

    private start(): void {
        this.helper = new ShelfHelper(this.script, (event) => this.onHelper(event));
        const dnd = global.backend.get_dnd();
        this.dndIds = [
            dnd.connect('dnd-enter', () => this.onDndEnter()),
            dnd.connect('dnd-position-change', (_d, x: number, y: number) => this.onDndPosition(x, y)),
            dnd.connect('dnd-leave', () => this.onDndLeave()),
        ];
    }

    private stop(): void {
        this.releaseRow();
        this.endDrop();
        const dnd = global.backend.get_dnd();
        for (const id of this.dndIds) dnd.disconnect(id);
        this.dndIds = [];
        this.helper?.destroy();
        this.helper = null;
        this.inside = false;
        this.ownDrag = false;
        this.externalDrag = false;
        this.missedEnters = 0;
    }

    private onHelper(event: HelperEvent): void {
        switch (event.kind) {
            case 'enter':
                this.inside = true;
                this.missedEnters = 0;
                this.clearTimeouts();
                this.rowNotch?.setHelperPointer(true);
                break;
            case 'leave':
                this.inside = false;
                this.rowNotch?.setShelfHover(null);
                this.rowNotch?.setHelperPointer(false);
                if (this.leaveTimeoutId) GLib.source_remove(this.leaveTimeoutId);
                this.leaveTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LEAVE_GRACE_MS, () => {
                    this.leaveTimeoutId = 0;
                    if (!this.ownDrag && !this.inside) this.releaseRow();
                    return GLib.SOURCE_REMOVE;
                });
                break;
            case 'hover':
                this.rowNotch?.setShelfHover(event.hit);
                break;
            case 'drag':
                this.ownDrag = event.active;
                if (!event.active && !this.inside) this.releaseRow();
                break;
        }
    }

    private releaseRow(): void {
        this.clearTimeouts();
        const notch = this.rowNotch;
        if (!notch) return;
        this.rowNotch = null;
        this.passThrough.restore();
        this.helper?.place(null);
        notch.setShelfHover(null);
        notch.setHelperPointer(false);
    }

    private clearTimeouts(): void {
        if (this.enterTimeoutId) GLib.source_remove(this.enterTimeoutId);
        if (this.leaveTimeoutId) GLib.source_remove(this.leaveTimeoutId);
        this.enterTimeoutId = 0;
        this.leaveTimeoutId = 0;
    }

    /** A drag started in some app; a drag out of the shelf is not a drop on it. */
    private onDndEnter(): void {
        if (this.rowNotch || this.ownDrag || this.inside) return;
        this.externalDrag = true;
    }

    private onDndPosition(x: number, y: number): void {
        if (!this.externalDrag || !this.helper) return;
        const current = this.dropNotch;
        const target =
            current && pointIn(current.dropRect(), x, y)
                ? current
                : (this.notches().find((n) => pointIn(n.dropTrigger(), x, y)) ?? null);
        if (target === current) return;
        this.endDrop();
        if (!target) return;
        this.dropNotch = target;
        target.setDropping(true);
        this.helper.place(target.dropRect());
        this.passThrough.set([target.chrome, Main.panel]);
    }

    private onDndLeave(): void {
        this.externalDrag = false;
        this.endDrop();
    }

    private endDrop(): void {
        const notch = this.dropNotch;
        if (!notch) return;
        this.dropNotch = null;
        this.passThrough.restore();
        this.helper?.place(null);
        notch.setDropping(false);
    }
}
