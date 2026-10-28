import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { OverlayLayout } from '../../shared/layout.js';

/** The unsung part of a line, out of 255. */
const DIM_OPACITY = 95;
/** The fill restarts only when it is this far from where the song is. */
const DRIFT = 0.08;

/**
 * A line of text that lights up from left to right: a dim copy under a
 * bright one seen through a clip that widens. While the song plays, the
 * clip eases linearly to the end of the line, so the compositor moves it
 * and nothing ticks.
 */
export class FillLabel {
    readonly actor: St.Widget;
    private readonly base: St.Label;
    private readonly clip: St.Widget;
    private readonly bright: St.Label;
    private width = 0;
    /** The line and play state the running fill was started for. */
    private key = '';
    private fraction = 0;

    constructor(styleClass: string, height: number) {
        this.actor = new St.Widget({ layout_manager: new OverlayLayout(), height, x_expand: true });
        this.base = this.label(styleClass);
        this.base.opacity = DIM_OPACITY;
        this.bright = this.label(styleClass);
        this.clip = new St.Widget({
            layout_manager: new OverlayLayout(),
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.FILL,
            width: 0,
        });
        this.clip.add_child(this.bright);
        this.actor.add_child(this.base);
        this.actor.add_child(this.clip);
    }

    /** The row's width; the text ellipsizes in it. */
    setWidth(width: number): void {
        this.width = width;
        this.actor.width = width;
        this.base.width = width;
        this.bright.width = width;
        this.key = '';
    }

    /**
     * Shows `text` with `fraction` of it lit; while `playing`, the rest
     * lights over `msLeft`. `line` tells one line from the next.
     */
    show(text: string, line: number, fraction: number, msLeft: number, playing: boolean): void {
        if (text !== this.base.text) {
            this.base.text = text;
            this.bright.text = text;
            this.key = '';
        }
        const key = `${line}:${playing}`;
        const animate = playing && msLeft > 0 && St.Settings.get().enable_animations;
        const drifted = Math.abs(this.litFraction() - fraction) > DRIFT;
        if (animate && key === this.key && !drifted) return;
        this.key = key;
        this.fraction = fraction;
        const full = this.textWidth();
        this.clip.remove_all_transitions();
        this.clip.width = Math.round(full * fraction);
        if (animate) this.clip.ease({ width: full, duration: msLeft, mode: Clutter.AnimationMode.LINEAR });
    }

    destroy(): void {
        this.clip.remove_all_transitions();
        this.actor.destroy();
    }

    /** How much is lit now, as the running fill has it. */
    private litFraction(): number {
        const full = this.textWidth();
        return full > 0 ? this.clip.width / full : this.fraction;
    }

    /** The text's own width, at most the row's. */
    private textWidth(): number {
        const [width] = this.base.clutter_text.get_layout().get_pixel_size();
        return Math.min(width, this.width);
    }

    private label(styleClass: string): St.Label {
        const label = new St.Label({
            style_class: styleClass,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }
}
