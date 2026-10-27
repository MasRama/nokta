import type Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { parseHexColor } from './logic/color.js';

export type EarSide = 'left' | 'right';

/** GJS frees the native context on $dispose(); the typings omit it. */
type PaintContext = Cairo.Context & { $dispose(): void };

/**
 * The small inward curve where the notch meets the top edge of the screen,
 * drawn once with Cairo and again only when its style changes.
 */
export class Ear {
    readonly actor: St.DrawingArea;
    private color: string;

    constructor(
        private readonly side: EarSide,
        radius: number,
        color: string,
    ) {
        this.color = color;
        this.actor = new St.DrawingArea({
            width: radius,
            height: radius,
            y_align: Clutter.ActorAlign.START,
        });
        this.actor.connect('repaint', () => this.paint());
    }

    setStyle(radius: number, color: string): void {
        this.color = color;
        this.actor.set_size(radius, radius);
        this.actor.queue_repaint();
    }

    private paint(): void {
        const [width, height] = this.actor.get_surface_size();
        if (width <= 0 || height <= 0) return;
        const cr = this.actor.get_context() as PaintContext;
        const r = Math.min(width, height);
        const { r: red, g: green, b: blue } = parseHexColor(this.color);
        cr.setSourceRGBA(red, green, blue, 1);
        // Fill the corner between the top edge and the body's side, minus a
        // quarter circle, so the edge curves smoothly into the notch.
        if (this.side === 'left') {
            cr.moveTo(0, 0);
            cr.lineTo(r, 0);
            cr.lineTo(r, r);
            cr.arcNegative(0, r, r, 0, -Math.PI / 2);
        } else {
            cr.moveTo(0, 0);
            cr.lineTo(r, 0);
            cr.arcNegative(r, r, r, -Math.PI / 2, -Math.PI);
        }
        cr.closePath();
        cr.fill();
        cr.$dispose();
    }
}
