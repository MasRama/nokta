import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { OverlayLayout } from '../../shared/layout.js';
import { mix, withAlpha } from '../../shared/logic/color.js';

const IDLE_ALPHA = 0.12;
const HOVER_ALPHA = 0.22;
const TILE_SIZE = 40;

/** The colors the pills and tiles are painted with. */
export interface ControlColors {
    foreground: string;
    accent: string;
    onAccent: string;
}

/** Off: a faint tint of the text color. On: filled with the accent. */
function paint(actor: St.Widget, on: boolean, hover: boolean, colors: ControlColors): void {
    if (on) {
        const background = hover ? mix(colors.accent, '#ffffff', 0.12) : colors.accent;
        actor.style = `background-color: ${background}; color: ${colors.onAccent};`;
    } else {
        const alpha = hover ? HOVER_ALPHA : IDLE_ALPHA;
        actor.style = `background-color: ${withAlpha(colors.foreground, alpha)}; color: ${colors.foreground};`;
    }
}

/** A quick toggle: a pill with an icon and a name, filled while on. */
export class TogglePill {
    readonly actor: St.Button;
    private on = false;
    private colors: ControlColors = { foreground: '#ffffff', accent: '#ffffff', onAccent: '#000000' };

    constructor(icon: Gio.Icon, label: string, onClick: () => void) {
        const box = new St.BoxLayout({ style_class: 'nokta-pill-box', x_align: Clutter.ActorAlign.CENTER });
        box.add_child(
            new St.Icon({
                style_class: 'nokta-pill-icon',
                gicon: icon,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        box.add_child(new St.Label({ style_class: 'nokta-pill-label', text: label, y_align: Clutter.ActorAlign.CENTER }));
        this.actor = new St.Button({ style_class: 'nokta-pill', child: box, x_expand: true, can_focus: true });
        this.actor.connect('notify::hover', () => this.repaint());
        this.actor.connect('clicked', onClick);
        this.repaint();
    }

    set(on: boolean): void {
        this.on = on;
        this.actor.checked = on;
        this.repaint();
    }

    setColors(colors: ControlColors): void {
        this.colors = colors;
        this.repaint();
    }

    private repaint(): void {
        paint(this.actor, this.on, this.actor.hover, this.colors);
    }
}

/** A round icon tile with its name under it; lit while its feature is on, with an optional count badge. */
export class Tile {
    readonly actor: St.Button;
    private readonly circle: St.Widget;
    private readonly badge: St.Label;
    private active = false;
    private colors: ControlColors = { foreground: '#ffffff', accent: '#ffffff', onAccent: '#000000' };

    /** `icon` is a theme icon's name, or an icon. */
    constructor(icon: string | Gio.Icon, label: string, onClick: () => void) {
        this.circle = new St.Widget({
            style_class: 'nokta-tile-circle',
            layout_manager: new OverlayLayout(),
            width: TILE_SIZE,
            height: TILE_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.circle.add_child(
            new St.Icon({
                style_class: 'nokta-tile-icon',
                gicon: typeof icon === 'string' ? new Gio.ThemedIcon({ name: icon }) : icon,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        this.badge = new St.Label({
            style_class: 'nokta-tile-badge',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            visible: false,
        });
        this.circle.add_child(this.badge);
        const box = setVertical(new St.BoxLayout({ style_class: 'nokta-tile-box' }));
        box.add_child(this.circle);
        box.add_child(new St.Label({ style_class: 'nokta-tile-label', text: label, x_align: Clutter.ActorAlign.CENTER }));
        this.actor = new St.Button({ style_class: 'nokta-tile', child: box, x_expand: true, can_focus: true });
        this.actor.connect('notify::hover', () => this.repaint());
        this.actor.connect('clicked', onClick);
        this.repaint();
    }

    set(active: boolean, badge: string | null = null): void {
        this.active = active;
        this.badge.visible = badge !== null;
        if (badge !== null) this.badge.text = badge;
        this.repaint();
    }

    setColors(colors: ControlColors): void {
        this.colors = colors;
        this.badge.style = `background-color: ${colors.accent}; color: ${colors.onAccent};`;
        this.repaint();
    }

    private repaint(): void {
        paint(this.circle, this.active, this.actor.hover, this.colors);
    }
}
