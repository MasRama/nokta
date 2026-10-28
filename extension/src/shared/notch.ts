import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { Ear } from './ears.js';
import { OverlayLayout } from './layout.js';
import { withAlpha } from './logic/color.js';
import { radiusAt } from './logic/shape.js';
import { settled, springFor, stepSpring, type ResizeKind, type SpringParams, type SpringState } from './logic/spring.js';

export type { ResizeKind } from './logic/spring.js';

/** The parts of the appearance config the notch shape uses. */
export interface NotchStyle {
    background: string;
    /** 0 = see-through, 1 = solid; only the background, not the content. */
    backgroundOpacity: number;
    foreground: string;
    /** The closed notch's height, where the corners are `cornerRadius`. */
    height: number;
    cornerRadius: number;
    earRadius: number;
    animationSpeed: number;
}

export interface MonitorArea {
    x: number;
    y: number;
    width: number;
}

/**
 * The black shape at the top center of the primary monitor: left ear, body,
 * right ear. Content goes into `body`, which clips it while resizing.
 *
 * Width and height follow one spring each, stepped on the same frames, so
 * they move together and a new size mid-way bends the motion instead of
 * restarting it. The corners round more as the body grows.
 */
export class Notch {
    readonly actor: St.Widget;
    readonly body: St.Widget;
    private readonly leftEar: Ear;
    private readonly rightEar: Ear;
    private style: NotchStyle;
    private monitor: MonitorArea = { x: 0, y: 0, width: 0 };
    /** The size the body is heading to. */
    private width = 0;
    private height = 0;
    private shownWidth: SpringState = { value: 0, velocity: 0 };
    private shownHeight: SpringState = { value: 0, velocity: 0 };
    private spring: SpringParams = springFor('width', 1);
    /** Runs only while the springs move. */
    private readonly timeline: Clutter.Timeline;
    private lastFrameUs = 0;
    private shownRadius = -1;

    constructor(style: NotchStyle) {
        this.style = style;
        this.actor = new St.Widget({
            style_class: 'nokta-notch',
            layout_manager: new Clutter.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL }),
            reactive: true,
            track_hover: true,
        });
        this.leftEar = new Ear('left', style.earRadius, style.background, style.backgroundOpacity);
        this.rightEar = new Ear('right', style.earRadius, style.background, style.backgroundOpacity);
        this.body = new St.Widget({
            style_class: 'nokta-body',
            layout_manager: new OverlayLayout(),
            clip_to_allocation: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        this.actor.add_child(this.leftEar.actor);
        this.actor.add_child(this.body);
        this.actor.add_child(this.rightEar.actor);
        this.timeline = new Clutter.Timeline({ actor: this.actor, duration: 1000, repeat_count: -1 });
        this.timeline.connect('new-frame', () => this.onFrame());
        this.applyBodyStyle();
    }

    setAppearance(style: NotchStyle): void {
        this.style = style;
        this.leftEar.setStyle(style.earRadius, style.background, style.backgroundOpacity);
        this.rightEar.setStyle(style.earRadius, style.background, style.backgroundOpacity);
        this.applyBodyStyle();
        this.jumpTo(this.width, this.height);
    }

    /** Where to center the notch; call again when monitors change. */
    setMonitor(monitor: MonitorArea): void {
        this.monitor = monitor;
        this.actor.y = monitor.y;
        this.jumpTo(this.width, this.height);
    }

    /** Animates the body to `width` × `height`, keeping the notch centered. */
    resizeTo(width: number, height: number, kind: ResizeKind): void {
        if (width === this.width && height === this.height) return;
        if (!St.Settings.get().enable_animations) {
            this.jumpTo(width, height);
            return;
        }
        this.width = width;
        this.height = height;
        this.spring = springFor(kind, this.style.animationSpeed);
        if (!this.timeline.is_playing()) {
            this.lastFrameUs = GLib.get_monotonic_time();
            this.timeline.start();
        }
    }

    /** Sets the size without animating. */
    jumpTo(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.timeline.stop();
        this.shownWidth = { value: width, velocity: 0 };
        this.shownHeight = { value: height, velocity: 0 };
        this.apply();
    }

    destroy(): void {
        this.timeline.stop();
        this.actor.destroy();
    }

    /** Where the body is once it is `width` × `height`, in stage coordinates. */
    bodyRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const ear = this.style.earRadius;
        const x = this.monitor.x + Math.round((this.monitor.width - width - 2 * ear) / 2) + ear;
        return { x, y: this.monitor.y, width, height };
    }

    private onFrame(): void {
        const now = GLib.get_monotonic_time();
        const dtMs = (now - this.lastFrameUs) / 1000;
        this.lastFrameUs = now;
        this.shownWidth = stepSpring(this.shownWidth, this.width, dtMs, this.spring);
        this.shownHeight = stepSpring(this.shownHeight, this.height, dtMs, this.spring);
        if (settled(this.shownWidth, this.width) && settled(this.shownHeight, this.height)) {
            this.timeline.stop();
            this.shownWidth = { value: this.width, velocity: 0 };
            this.shownHeight = { value: this.height, velocity: 0 };
        }
        this.apply();
    }

    /** Draws the body at the springs' size, on whole pixels so text stays sharp. */
    private apply(): void {
        const width = Math.round(this.shownWidth.value);
        const height = Math.max(Math.round(this.shownHeight.value), 0);
        const total = width + 2 * this.style.earRadius;
        this.actor.set_position(this.monitor.x + Math.round((this.monitor.width - total) / 2), this.monitor.y);
        this.actor.width = total;
        this.body.height = height;
        const radius = Math.round(radiusAt(height, { height: this.style.height, radius: this.style.cornerRadius }));
        if (radius !== this.shownRadius) {
            this.shownRadius = radius;
            this.applyBodyStyle();
        }
    }

    private applyBodyStyle(): void {
        const { background, backgroundOpacity, foreground } = this.style;
        const r = this.shownRadius < 0 ? this.style.cornerRadius : this.shownRadius;
        this.body.style =
            `background-color: ${withAlpha(background, backgroundOpacity)}; color: ${foreground};` +
            ` border-radius: 0 0 ${r}px ${r}px;`;
    }
}
