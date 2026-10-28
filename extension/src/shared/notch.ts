import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { OverlayLayout } from './layout.js';
import { clampAlpha, parseCssColor } from './logic/color.js';
import { envelope, frameMs, notchX } from './logic/motion.js';
import { radiusAt } from './logic/shape.js';
import { THEMES, type Palette } from './logic/theme.js';
import {
    kickVelocity,
    settled,
    springFor,
    stepSpring,
    type ResizeKind,
    type SpringParams,
    type SpringState,
} from './logic/spring.js';
import { Shape, type Rgba, type ShapeGeometry } from './shape.js';

export type { ResizeKind } from './logic/spring.js';

/** The parts of the appearance config the notch shape uses. */
export interface NotchStyle {
    /** The closed notch's height, where the corners are `cornerRadius`. */
    height: number;
    cornerRadius: number;
    earRadius: number;
    animationSpeed: number;
}

/** How long the glow takes to come and to go, before animation_speed. */
const GLOW_IN_MS = 150;
const GLOW_OUT_MS = 250;
/** The glow's colour is this strong at its brightest. */
const GLOW_ALPHA = 0.9;
/** Room around the body for the glow's blur, in px. */
const GLOW_MARGIN = 48;
/** A waiting kick goes off this close to the target, before the width slows to a crawl. */
const KICK_NEAR_PX = 3;
const NO_COLOR: Rgba = [0, 0, 0, 0];

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
 *
 * A shader draws the shape (`shape.ts`). While the springs move, the actors
 * keep one size, large enough for the whole motion, and a frame only moves
 * the shader's edges and the body's clip: no relayout and no restyle, so
 * nothing but the shape is redrawn. Once the springs settle, the actors
 * take the final size, which leaves every view on the same pixel.
 *
 * `glow` lies under the shape, outside the body's clip; it is a child of
 * `actor` that reaches past it, so it takes no input.
 */
export class Notch {
    readonly actor: St.Widget;
    readonly body: St.Widget;
    readonly glow: St.Widget;
    private readonly shapeActor: St.Widget;
    private readonly shape: Shape;
    private readonly glowShape: Shape;
    private glowColor: string | null = null;
    /** The shell destroys its chrome at shutdown, the glow with it. */
    private glowGone = false;
    private style: NotchStyle;
    private palette: Palette;
    private monitor: MonitorArea = { x: 0, y: 0, width: 0 };
    /** The size the body is heading to. */
    private width = 0;
    private height = 0;
    /** The body's size as laid out: the final size at rest, room for the motion while it moves. */
    private laidWidth = -1;
    private laidHeight = -1;
    private shownWidth: SpringState = { value: 0, velocity: 0 };
    private shownHeight: SpringState = { value: 0, velocity: 0 };
    private spring: SpringParams = springFor('width', 1);
    /** A kick waiting for the width to reach its target, and from which side it comes. */
    private pendingKick: { fraction: number; side: number } | null = null;
    /** Runs only while the springs move. */
    private readonly timeline: Clutter.Timeline;
    private lastFrameUs = 0;

    constructor(style: NotchStyle, palette: Palette) {
        this.style = style;
        this.palette = palette;
        this.actor = new St.Widget({
            style_class: 'nokta-notch',
            layout_manager: new Clutter.FixedLayout(),
            reactive: true,
            track_hover: true,
        });
        // Hidden while faded out, so it costs no offscreen paint.
        this.glow = new St.Widget({ style_class: 'nokta-glow', opacity: 0, visible: false });
        this.glow.connect('destroy', () => (this.glowGone = true));
        this.glowShape = new Shape(this.glow, true);
        this.shapeActor = new St.Widget({ style_class: 'nokta-shape' });
        this.shape = new Shape(this.shapeActor, false);
        this.body = new St.Widget({
            style_class: 'nokta-body',
            layout_manager: new OverlayLayout(),
            clip_to_allocation: true,
        });
        this.actor.add_child(this.glow);
        this.actor.add_child(this.shapeActor);
        this.actor.add_child(this.body);
        this.timeline = new Clutter.Timeline({ actor: this.actor, duration: 1000, repeat_count: -1 });
        this.timeline.connect('new-frame', () => this.onFrame());
        this.applyPalette();
    }

    setAppearance(style: NotchStyle): void {
        this.style = style;
        this.applyPalette();
        this.jumpTo(this.width, this.height);
    }

    /** The colors, which follow the theme and the cover; the size stays. */
    setPalette(palette: Palette): void {
        const old = this.palette;
        this.palette = palette;
        if (JSON.stringify(old) !== JSON.stringify(palette)) this.applyPalette();
    }

    /** Where to center the notch; call again when monitors change. */
    setMonitor(monitor: MonitorArea): void {
        this.monitor = monitor;
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
        this.animate();
    }

    /**
     * Pushes the width past its target by `fraction`, to spring back; not
     * with animations off. While the width still moves, the kick waits until
     * it gets there, or the motion would swallow it.
     */
    kick(fraction: number): void {
        if (!St.Settings.get().enable_animations) return;
        const side = Math.sign(this.width - this.shownWidth.value);
        this.pendingKick = { fraction, side };
        if (Math.abs(this.width - this.shownWidth.value) < 1) this.applyKick();
        this.animate();
    }

    /** A glow in `color` under the body, fading in; null fades it out. */
    setGlow(color: string | null): void {
        if (color === this.glowColor || this.glowGone) return;
        this.glowColor = color;
        this.glow.remove_all_transitions();
        const speed = this.style.animationSpeed;
        if (color) {
            const [r, g, b] = parseCssColor(color) ?? [0, 0, 0];
            this.glow.show();
            this.glowShape.setColors({ top: [r, g, b, GLOW_ALPHA], bottom: NO_COLOR, border: NO_COLOR });
            this.glow.ease({ opacity: 255, duration: GLOW_IN_MS * speed, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        } else {
            this.glow.ease({
                opacity: 0,
                duration: GLOW_OUT_MS * speed,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this.glowColor && !this.glowGone) this.glow.hide();
                },
            });
        }
    }

    /** Sets the size without animating. */
    jumpTo(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.pendingKick = null;
        this.timeline.stop();
        this.shownWidth = { value: width, velocity: 0 };
        this.shownHeight = { value: height, velocity: 0 };
        // The monitor or the ears may have changed: lay out again.
        this.laidWidth = -1;
        this.layOut(width, height);
        this.apply();
    }

    destroy(): void {
        this.timeline.stop();
        this.actor.destroy();
    }

    /** Where the body is once it is `width` × `height`, in stage coordinates. */
    bodyRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const x = notchX(this.monitor, width, this.style.earRadius) + this.style.earRadius;
        return { x, y: this.monitor.y, width, height };
    }

    private applyKick(): void {
        if (!this.pendingKick) return;
        const velocity = this.shownWidth.velocity + kickVelocity(this.width, this.spring, this.pendingKick.fraction);
        this.shownWidth = { ...this.shownWidth, velocity };
        this.pendingKick = null;
    }

    /** Makes room for the motion to the new target once, then starts the springs. */
    private animate(): void {
        this.layOut(envelope(this.shownWidth.value, this.width), envelope(this.shownHeight.value, this.height));
        this.apply();
        if (this.timeline.is_playing()) return;
        this.lastFrameUs = GLib.get_monotonic_time();
        this.timeline.start();
    }

    private onFrame(): void {
        const now = GLib.get_monotonic_time();
        const refresh = this.timeline.frame_clock?.get_refresh_rate() ?? 0;
        const dtMs = frameMs((now - this.lastFrameUs) / 1000, refresh);
        this.lastFrameUs = now;
        this.shownWidth = stepSpring(this.shownWidth, this.width, dtMs, this.spring);
        this.shownHeight = stepSpring(this.shownHeight, this.height, dtMs, this.spring);
        if (this.pendingKick && (this.shownWidth.value - this.width) * this.pendingKick.side >= -KICK_NEAR_PX)
            this.applyKick();
        if (settled(this.shownWidth, this.width) && settled(this.shownHeight, this.height)) {
            this.timeline.stop();
            this.shownWidth = { value: this.width, velocity: 0 };
            this.shownHeight = { value: this.height, velocity: 0 };
            this.layOut(this.width, this.height);
        } else if (this.shownWidth.value > this.laidWidth || this.shownHeight.value > this.laidHeight) {
            // A kick on top of an overshoot: rare, so a relayout is fine.
            this.layOut(envelope(this.shownWidth.value, this.width), envelope(this.shownHeight.value, this.height));
        }
        this.apply();
    }

    /** Sizes and places the actors for a body of `width` × `height`; only when that changes. */
    private layOut(width: number, height: number): void {
        if (width === this.laidWidth && height === this.laidHeight) return;
        this.laidWidth = width;
        this.laidHeight = height;
        const ear = this.style.earRadius;
        const total = width + 2 * ear;
        const tall = Math.max(height, ear);
        this.actor.set_position(notchX(this.monitor, width, ear), this.monitor.y);
        this.actor.set_size(total, tall);
        this.shapeActor.set_size(total, tall);
        this.body.set_position(ear, 0);
        this.body.set_size(width, height);
        if (!this.glowGone) {
            this.glow.set_position(-GLOW_MARGIN, 0);
            this.glow.set_size(total + 2 * GLOW_MARGIN, tall + GLOW_MARGIN);
        }
    }

    /** Draws the shape at the springs' size and clips the views to it. */
    private apply(): void {
        const width = this.shownWidth.value;
        const height = Math.max(this.shownHeight.value, 0);
        const ear = this.style.earRadius;
        const left = notchX(this.monitor, this.laidWidth, ear);
        // Centred where the body rests, so its edges land on whole pixels there.
        const center = notchX(this.monitor, this.width, ear) + ear + this.width / 2 - left;
        const geometry: ShapeGeometry = {
            width: this.laidWidth + 2 * ear,
            height: Math.max(this.laidHeight, ear),
            center,
            bodyWidth: width,
            bodyHeight: height,
            earRadius: ear,
            cornerRadius: radiusAt(height, { height: this.style.height, radius: this.style.cornerRadius }),
        };
        this.shape.setGeometry(geometry);
        if (!this.glowGone) {
            this.glowShape.setGeometry({
                ...geometry,
                width: geometry.width + 2 * GLOW_MARGIN,
                height: geometry.height + GLOW_MARGIN,
                center: center + GLOW_MARGIN,
            });
        }
        if (width === this.laidWidth && height === this.laidHeight) this.body.remove_clip();
        else this.body.set_clip(center - ear - width / 2, 0, width, height);
    }

    private applyPalette(): void {
        const { background, backgroundOpacity, gradient, foreground, border, theme } = this.palette;
        for (const name of THEMES) this.actor.remove_style_class_name(`nokta-theme-${name}`);
        this.actor.add_style_class_name(`nokta-theme-${theme}`);
        // The views take their text colour from the body.
        this.body.style = `color: ${foreground};`;
        const [r, g, b] = parseCssColor(background) ?? [0, 0, 0];
        const alpha = clampAlpha(backgroundOpacity);
        const top: Rgba = [r, g, b, alpha];
        let bottom = top;
        if (gradient) {
            const [gr, gg, gb] = parseCssColor(gradient) ?? [r, g, b];
            bottom = [gr, gg, gb, alpha];
        }
        this.shape.setColors({ top, bottom, border: (border && parseCssColor(border)) || NO_COLOR });
    }
}
