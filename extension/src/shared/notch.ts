import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { durationFor, modeFor, type ResizeKind } from './animation.js';
import { Ear } from './ears.js';
import { withAlpha } from './logic/color.js';

/** The parts of the appearance config the notch shape uses. */
export interface NotchStyle {
    background: string;
    /** 0 = see-through, 1 = solid; only the background, not the content. */
    backgroundOpacity: number;
    foreground: string;
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
 */
export class Notch {
    readonly actor: St.Widget;
    readonly body: St.Widget;
    private readonly leftEar: Ear;
    private readonly rightEar: Ear;
    private style: NotchStyle;
    private monitor: MonitorArea = { x: 0, y: 0, width: 0 };
    private width = 0;
    private height = 0;

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
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        this.actor.add_child(this.leftEar.actor);
        this.actor.add_child(this.body);
        this.actor.add_child(this.rightEar.actor);
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
        this.width = width;
        this.height = height;
        const duration = durationFor(kind, this.style.animationSpeed);
        const mode = modeFor(kind);
        this.actor.ease({ x: this.centeredX(), width: this.totalWidth(), duration, mode });
        this.body.ease({ height, duration, mode });
    }

    /** Sets the size without animating. */
    jumpTo(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.actor.remove_all_transitions();
        this.body.remove_all_transitions();
        this.actor.set_position(this.centeredX(), this.monitor.y);
        this.actor.width = this.totalWidth();
        this.body.height = height;
    }

    destroy(): void {
        this.actor.destroy();
    }

    /** Where the body is once it is `width` × `height`, in stage coordinates. */
    bodyRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const ear = this.style.earRadius;
        const x = this.monitor.x + Math.round((this.monitor.width - width - 2 * ear) / 2) + ear;
        return { x, y: this.monitor.y, width, height };
    }

    private totalWidth(): number {
        return this.width + 2 * this.style.earRadius;
    }

    private centeredX(): number {
        return this.monitor.x + Math.round((this.monitor.width - this.totalWidth()) / 2);
    }

    private applyBodyStyle(): void {
        const { cornerRadius: r, background, backgroundOpacity, foreground } = this.style;
        this.body.style =
            `background-color: ${withAlpha(background, backgroundOpacity)}; color: ${foreground};` +
            ` border-radius: 0 0 ${r}px ${r}px;`;
    }
}
