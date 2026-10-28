import type Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { parseHexColor } from '../../shared/logic/color.js';

const INSET = 10;
const RADIUS = 14;
const DASH = [6, 5];

type PaintContext = Cairo.Context & { $dispose(): void };

/** The open notch while files are dragged over it: a dashed area saying where to drop. */
export class DropView {
    readonly actor: St.Widget;
    private readonly border: St.DrawingArea;
    private foreground = '#ffffff';
    private readonly repaintId: number;

    constructor() {
        this.actor = new St.Widget({ style_class: 'nokta-drop', layout_manager: new Clutter.BinLayout() });
        this.border = new St.DrawingArea({ x_expand: true, y_expand: true });
        this.repaintId = this.border.connect('repaint', () => this.paint());
        const content = setVertical(
            new St.BoxLayout({
                style_class: 'nokta-drop-content',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        content.add_child(
            new St.Icon({
                style_class: 'nokta-drop-icon',
                gicon: new Gio.ThemedIcon({ name: 'folder-download-symbolic' }),
                x_align: Clutter.ActorAlign.CENTER,
            }),
        );
        content.add_child(new St.Label({ style_class: 'nokta-drop-label', text: 'Drop to keep here' }));
        this.actor.add_child(this.border);
        this.actor.add_child(content);
    }

    setForeground(color: string): void {
        this.foreground = color;
        this.border.queue_repaint();
    }

    destroy(): void {
        this.border.disconnect(this.repaintId);
        this.actor.destroy();
    }

    private paint(): void {
        const cr = this.border.get_context() as PaintContext;
        const [width, height] = this.border.get_surface_size();
        const { r, g, b } = parseHexColor(this.foreground, { r: 1, g: 1, b: 1 });
        const x = INSET;
        const y = INSET;
        const w = width - 2 * INSET;
        const h = height - 2 * INSET;
        cr.setSourceRGBA(r, g, b, 0.55);
        cr.setLineWidth(2);
        cr.setDash(DASH, 0);
        cr.newSubPath();
        cr.arc(x + w - RADIUS, y + RADIUS, RADIUS, -Math.PI / 2, 0);
        cr.arc(x + w - RADIUS, y + h - RADIUS, RADIUS, 0, Math.PI / 2);
        cr.arc(x + RADIUS, y + h - RADIUS, RADIUS, Math.PI / 2, Math.PI);
        cr.arc(x + RADIUS, y + RADIUS, RADIUS, Math.PI, (3 * Math.PI) / 2);
        cr.closePath();
        cr.stroke();
        cr.$dispose();
    }
}
