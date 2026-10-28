import Cairo from 'cairo';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import { mix, parseCssColor, parseHexColor, withAlpha } from '../shared/logic/color.js';
import { SAMPLE_SONG, type PreviewModel } from './logic/look.js';

type PaintContext = Cairo.Context & { $dispose(): void };

const HEIGHT = 190;
const NOTCH_WIDTH = 380;
const NOTCH_HEIGHT = 104;
const COVER = 60;
const BARS = [10, 18, 8, 14];

// gjs has these; its typings leave them out.
type Linear = Cairo.LinearGradient & { addColorStopRGBA(offset: number, r: number, g: number, b: number, a: number): void };
const LinearGradient = Cairo.LinearGradient as unknown as new (x0: number, y0: number, x1: number, y1: number) => Linear;

/** A gradient from (x0, y0) to (x1, y1) through `#rrggbb` stops, each `[offset, color, alpha]`. */
export function linear(x0: number, y0: number, x1: number, y1: number, stops: [number, string, number][]): Cairo.Pattern {
    const pattern = new LinearGradient(x0, y0, x1, y1);
    for (const [offset, color, alpha] of stops) {
        const { r, g, b } = parseHexColor(color);
        pattern.addColorStopRGBA(offset, r, g, b, alpha);
    }
    return pattern;
}

/** Sets a `#rrggbb` or `rgba()` color, times `alpha`; the parsers give 0..1 channels. */
export function setColor(cr: Cairo.Context, color: string, alpha = 1): void {
    const css = parseCssColor(color);
    if (css) {
        const [r, g, b, a] = css;
        cr.setSourceRGBA(r, g, b, a * alpha);
        return;
    }
    const { r, g, b } = parseHexColor(color);
    cr.setSourceRGBA(r, g, b, alpha);
}

/** The notch's outline hanging from y = 0: ears curving out to the top edge, rounded bottom corners. */
export function notchPath(cr: Cairo.Context, x: number, width: number, height: number, radius: number, ear: number): void {
    const r = Math.min(radius, height / 2, width / 2);
    cr.newPath();
    cr.moveTo(x - ear, 0);
    if (ear > 0) cr.arc(x - ear, ear, ear, -Math.PI / 2, 0);
    cr.lineTo(x, height - r);
    cr.arcNegative(x + r, height - r, r, Math.PI, Math.PI / 2);
    cr.lineTo(x + width - r, height);
    cr.arcNegative(x + width - r, height - r, r, Math.PI / 2, 0);
    cr.lineTo(x + width, ear);
    if (ear > 0) cr.arc(x + width + ear, ear, ear, Math.PI, (3 * Math.PI) / 2);
    cr.closePath();
}

/** Fills the current path with the palette's body: its gradient, at the theme's opacity. */
export function fillBody(cr: Cairo.Context, model: Pick<PreviewModel, 'palette'>, height: number): void {
    const { background, gradient, backgroundOpacity, border } = model.palette;
    const fill = linear(0, 0, 0, height, [
        [0, background, backgroundOpacity],
        [1, gradient ?? background, backgroundOpacity],
    ]);
    cr.setSource(fill);
    cr.fillPreserve();
    if (border) {
        setColor(cr, border);
        cr.setLineWidth(1);
        cr.stroke();
    } else {
        cr.newPath();
    }
}

function roundedRect(cr: Cairo.Context, x: number, y: number, w: number, h: number, r: number): void {
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
    cr.closePath();
}

/**
 * The top of a desktop with the notch open on a sample song, in the chosen
 * theme: a cover, the title and artist, the equalizer in the accent and,
 * while it is on, the progress line along the notch's bottom edge.
 */
export class NotchPreview {
    readonly widget: Gtk.DrawingArea;
    private model: PreviewModel | null = null;

    constructor() {
        this.widget = new Gtk.DrawingArea({ content_height: HEIGHT, hexpand: true, css_classes: ['nokta-preview'] });
        this.widget.set_draw_func((_area, cr, width, height) => {
            const paint = cr as PaintContext;
            if (this.model) this.draw(paint, width, height, this.model);
            paint.$dispose();
        });
    }

    update(model: PreviewModel): void {
        this.model = model;
        this.widget.queue_draw();
    }

    private draw(cr: Cairo.Context, width: number, height: number, model: PreviewModel): void {
        const { palette } = model;
        roundedRect(cr, 0, 0, width, height, 16);
        cr.clip();
        // A dusk wallpaper, so a glass or paper notch has something to sit on.
        const sky = linear(0, 0, width, height, [
            [0, '#3b2c5c', 1],
            [1, '#0f1a2e', 1],
        ]);
        cr.setSource(sky);
        cr.paint();

        const w = Math.min(NOTCH_WIDTH, width - 48);
        const x = (width - w) / 2;
        notchPath(cr, x, w, NOTCH_HEIGHT, model.cornerRadius, model.earRadius);
        fillBody(cr, model, NOTCH_HEIGHT);

        // The cover, a gradient of the sample song's color.
        const coverX = x + 22;
        const coverY = 22;
        const cover = linear(coverX, coverY, coverX + COVER, coverY + COVER, [
            [0, mix(SAMPLE_SONG.cover, '#ffffff', 0.2), 1],
            [1, mix(SAMPLE_SONG.cover, '#000000', 0.45), 1],
        ]);
        roundedRect(cr, coverX, coverY, COVER, COVER, 12);
        cr.setSource(cover);
        cr.fill();

        const textX = coverX + COVER + 16;
        this.text(cr, model.title, textX, coverY + 8, 15, Pango.Weight.BOLD, palette.foreground);
        this.text(cr, model.artist, textX, coverY + 32, 13, Pango.Weight.MEDIUM, withAlpha(palette.foreground, 0.6));

        // The equalizer, its bars standing on one line.
        setColor(cr, palette.accent);
        const base = coverY + 44;
        BARS.forEach((bar, i) => {
            roundedRect(cr, x + w - 48 + i * 7, base - bar, 4, bar, 2);
            cr.fill();
        });

        if (model.progress !== null) {
            const inset = Math.max(model.cornerRadius, 12);
            const length = w - inset * 2;
            setColor(cr, palette.foreground, 0.15);
            roundedRect(cr, x + inset, NOTCH_HEIGHT - 5, length, 3, 1.5);
            cr.fill();
            setColor(cr, palette.accent);
            roundedRect(cr, x + inset, NOTCH_HEIGHT - 5, length * model.progress, 3, 1.5);
            cr.fill();
        }
    }

    private text(cr: Cairo.Context, text: string, x: number, y: number, size: number, weight: Pango.Weight, color: string): void {
        const layout = this.widget.create_pango_layout(text);
        const font = this.widget.get_pango_context().get_font_description()?.copy() ?? new Pango.FontDescription();
        font.set_absolute_size(size * Pango.SCALE);
        font.set_weight(weight);
        layout.set_font_description(font);
        setColor(cr, color);
        cr.moveTo(x, y);
        PangoCairo.show_layout(cr, layout);
    }
}
