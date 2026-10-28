import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { DOT_COLORS, DOT_GAP, DOT_SIZE, dotsPlace, type Dot } from './logic/dots.js';

/** A row of dots at the closed notch's left edge, over the idle and collapsed views. */
export class PrivacyDots {
    readonly actor: St.BoxLayout;
    private shown = '';

    constructor() {
        this.actor = new St.BoxLayout({
            style_class: 'nokta-privacy-dots',
            // A BinLayout honors the alignment only of expanding children.
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        this.actor.hide();
    }

    /**
     * `height` and `cornerRadius` are the closed notch's. Returns where
     * content beside the dots may start, 0 without dots.
     */
    update(dots: readonly Dot[], height: number, cornerRadius: number): number {
        const place = dotsPlace(height, cornerRadius, dots.length);
        const key = `${dots.join()}@${height}/${cornerRadius}`;
        if (key === this.shown) return place.contentLeft;
        this.shown = key;
        this.actor.destroy_all_children();
        for (const dot of dots) {
            this.actor.add_child(
                new St.Widget({
                    style_class: 'nokta-privacy-dot',
                    width: DOT_SIZE,
                    height: DOT_SIZE,
                    style: `background-color: ${DOT_COLORS[dot]}; border-radius: ${DOT_SIZE}px;`,
                }),
            );
        }
        // St has no CSS margins; padding places the dots.
        this.actor.style = `spacing: ${DOT_GAP}px; padding-left: ${place.left}px; padding-top: ${place.top}px;`;
        return place.contentLeft;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
