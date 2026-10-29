import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { flierTransform, type Rect } from './logic/morph.js';

/** The flight opens in step with the body's open spring, and closes faster. */
const OPEN_MS = 360;
const CLOSE_MS = 260;

/** The extents of `actor` on the stage as drawn now, or null when it has none. */
export function stageRect(actor: Clutter.Actor): Rect | null {
    if (!actor.mapped) return null;
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
}

/**
 * A layer over the views, inside the body's clip, where one actor flies
 * from its place in the old view to its place in the new one. The flier is
 * a clone of `big`, the larger of the two, shrunk where it needs to be, so
 * it is never scaled up. Both real actors stay hidden while it flies.
 *
 * Places are in stage coordinates; `origin` gives where the body's top left
 * corner is laid out, which moves when the body takes its final size.
 */
export class MorphLayer {
    readonly actor: St.Widget;
    private flier: Clutter.Clone | null = null;
    /** The actors hidden while the flier is out, with the opacity each goes back to. */
    private hidden: Array<[Clutter.Actor, number]> = [];
    private waitId = 0;
    private waitActor: Clutter.Actor | null = null;
    private idleId = 0;
    /** The body's origin the flier was placed against. */
    private placedOrigin: [number, number] = [0, 0];
    private destroyed = false;

    constructor(private readonly origin: () => [number, number]) {
        this.actor = new St.Widget({
            style_class: 'nokta-morph',
            layout_manager: new Clutter.FixedLayout(),
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            reactive: false,
        });
        // The body takes its final size after the springs: keep the flier where it was on screen.
        this.actor.connect('notify::allocation', () => this.follow());
    }

    /**
     * Flies a clone of `big` from `fromRect`, where `from` is drawn now (see
     * `stageRect`), to where `to` rests (`toRect`, null while `to` is not
     * laid out yet; then the flight waits for its first layout). Nothing
     * flies when either place is missing.
     */
    fly(
        from: Clutter.Actor,
        fromRect: Rect | null,
        to: Clutter.Actor,
        toRect: () => Rect | null,
        big: Clutter.Actor,
        opening: boolean,
        speed: number,
    ): void {
        this.cancel();
        if (!fromRect) return;
        this.hide(from);
        this.hide(to);
        const start = (): void => {
            const target = toRect();
            if (!target) {
                this.cancel();
                return;
            }
            this.launch(fromRect, target, big, opening, speed);
        };
        if (toRect()) {
            start();
            return;
        }
        // Shown for the first time: its place is known once it is laid out.
        this.waitActor = to;
        this.waitId = to.connect('notify::allocation', () => {
            this.stopWaiting();
            this.idleId = GLib.idle_add(GLib.PRIORITY_HIGH, () => {
                this.idleId = 0;
                if (!this.destroyed) start();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    /** Ends the flight at once and shows the real actors again. */
    cancel(): void {
        this.stopWaiting();
        if (this.idleId) {
            GLib.source_remove(this.idleId);
            this.idleId = 0;
        }
        if (this.flier) {
            const flier = this.flier;
            this.flier = null;
            flier.remove_all_transitions();
            flier.destroy();
        }
        for (const [actor, opacity] of this.hidden) actor.opacity = opacity;
        this.hidden = [];
    }

    /** The views go with the notch: nothing is shown again, the flier goes with the layer. */
    destroy(): void {
        this.destroyed = true;
        this.stopWaiting();
        if (this.idleId) GLib.source_remove(this.idleId);
        this.idleId = 0;
        this.flier = null;
        this.hidden = [];
        this.actor.destroy();
    }

    private launch(fromRect: Rect, toRect: Rect, big: Clutter.Actor, opening: boolean, speed: number): void {
        const [ox, oy] = this.origin();
        this.placedOrigin = [ox, oy];
        const local = (r: Rect): Rect => ({ ...r, x: r.x - ox, y: r.y - oy });
        // The clone's own size is big's, so the transform scales it from there.
        const size = Math.max(fromRect.width, toRect.width);
        const bigRect = { x: 0, y: 0, width: size, height: size };
        const a = flierTransform(local(fromRect), bigRect);
        const b = flierTransform(local(toRect), bigRect);
        const flier = new Clutter.Clone({ source: big, width: size, height: size });
        flier.set_pivot_point(0, 0);
        flier.set_position(a.x, a.y);
        flier.set_scale(a.scale, a.scale);
        this.actor.add_child(flier);
        this.flier = flier;
        flier.ease({
            x: b.x,
            y: b.y,
            scale_x: b.scale,
            scale_y: b.scale,
            duration: Math.round((opening ? OPEN_MS : CLOSE_MS) * speed),
            mode: opening ? Clutter.AnimationMode.EASE_OUT_BACK : Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: (finished: boolean) => {
                if (finished && this.flier === flier) this.cancel();
            },
        });
    }

    private follow(): void {
        if (!this.flier) return;
        const [ox, oy] = this.origin();
        const [px, py] = this.placedOrigin;
        this.flier.translation_x = px - ox;
        this.flier.translation_y = py - oy;
    }

    private hide(actor: Clutter.Actor): void {
        this.hidden.push([actor, actor.opacity]);
        actor.opacity = 0;
    }

    private stopWaiting(): void {
        if (this.waitActor && this.waitId) this.waitActor.disconnect(this.waitId);
        this.waitActor = null;
        this.waitId = 0;
    }
}
