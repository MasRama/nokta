import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type { Line } from './logic/progress-line.js';

/** The accent at 70 %; St CSS has no opacity. */
const LINE_OPACITY = 178;

/**
 * A 2 px line along the closed notch's bottom edge, inset by the corner
 * radius. It fills with one linear ease to its end, like the karaoke fill,
 * and starts again on each change; no timer.
 */
export class ProgressLine {
    readonly actor: St.Bin;
    private readonly fill: St.Widget;

    constructor() {
        this.fill = new St.Widget({ style_class: 'nokta-progress-line-fill', x_expand: true });
        this.fill.set_pivot_point(0, 0.5);
        this.actor = new St.Bin({
            style_class: 'nokta-progress-line',
            // A BinLayout honors the alignment only of expanding children.
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
            child: this.fill,
        });
        this.actor.opacity = LINE_OPACITY;
        this.actor.hide();
    }

    /** Null hides it. */
    show(line: Line | null, color: string, cornerRadius: number): void {
        this.fill.remove_all_transitions();
        if (!line) {
            this.actor.hide();
            return;
        }
        // St has no CSS margins; padding insets the line.
        const frame = `padding: 0 ${cornerRadius}px;`;
        if (this.actor.style !== frame) this.actor.style = frame;
        const paint = `background-color: ${color};`;
        if (this.fill.style !== paint) this.fill.style = paint;
        this.fill.scale_x = line.fraction;
        this.actor.show();
        if (line.msToEnd)
            this.fill.ease({ scale_x: 1, duration: Math.round(line.msToEnd), mode: Clutter.AnimationMode.LINEAR });
    }

    destroy(): void {
        this.actor.destroy();
    }
}
