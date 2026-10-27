import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { DOT_COLORS, DOT_GAP, DOT_SIZE, dotsTop, type Dot } from './logic/dots.js';

/** The dots at the notch's left edge, over every view. */
export class PrivacyDots {
    readonly actor: St.BoxLayout;
    private shown = '';

    constructor() {
        this.actor = setVertical(
            new St.BoxLayout({
                style_class: 'nokta-privacy-dots',
                // A BinLayout honors the alignment only of expanding children.
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.START,
            }),
        );
        this.actor.hide();
    }

    /** `height` is the closed notch's height; the dots stay centered on it. */
    update(dots: readonly Dot[], height: number): void {
        const key = `${dots.join()}@${height}`;
        if (key === this.shown) return;
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
        this.actor.style = `spacing: ${DOT_GAP}px; padding-left: 3px; padding-top: ${dotsTop(height, dots.length)}px;`;
        this.actor.visible = dots.length > 0;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
