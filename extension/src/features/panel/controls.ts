import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { OverlayLayout } from '../../shared/layout.js';
import { mix, withAlpha } from '../../shared/logic/color.js';
import { onTone, toneOn } from '../../shared/logic/tones.js';
import { iconFor } from '../../shared/icons.js';

const IDLE_ALPHA = 0.1;
const HOVER_ALPHA = 0.18;
const TILE_SIZE = 40;

/** The colors the pills and tiles are painted with. */
export interface ControlColors {
    foreground: string;
    accent: string;
    onAccent: string;
    /** A light notch, where a tone used for an icon is darkened. */
    light: boolean;
}

const DEFAULT_COLORS: ControlColors = { foreground: '#ffffff', accent: '#ffffff', onAccent: '#000000', light: false };

/**
 * Off: a faint tint of the text color, with the icon in the control's own
 * tone. On: filled with that tone.
 */
function paint(surface: St.Widget, icon: St.Icon, on: boolean, hover: boolean, tone: string, colors: ControlColors): void {
    if (on) {
        const background = hover ? mix(tone, '#ffffff', 0.12) : tone;
        surface.style = `background-color: ${background}; color: ${onTone(tone)};`;
        icon.style = '';
    } else {
        const alpha = hover ? HOVER_ALPHA : IDLE_ALPHA;
        surface.style = `background-color: ${withAlpha(colors.foreground, alpha)}; color: ${colors.foreground};`;
        icon.style = `color: ${toneOn(tone, colors.light)};`;
    }
}

/** A quick toggle: a pill with an icon and a name, filled with its tone while on. */
export class TogglePill {
    readonly actor: St.Button;
    private readonly icon: St.Icon;
    private on = false;
    private colors = DEFAULT_COLORS;

    constructor(
        icon: Gio.Icon,
        label: string,
        private readonly tone: string,
        onClick: () => void,
    ) {
        const box = new St.BoxLayout({ style_class: 'nokta-pill-box', x_align: Clutter.ActorAlign.CENTER });
        this.icon = new St.Icon({ style_class: 'nokta-pill-icon', gicon: icon, y_align: Clutter.ActorAlign.CENTER });
        box.add_child(this.icon);
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
        paint(this.actor, this.icon, this.on, this.actor.hover, this.tone, this.colors);
    }
}

/** A rounded square tile with its name under it; filled with its tone while its feature is on, with an optional count badge. */
export class Tile {
    readonly actor: St.Button;
    private readonly circle: St.Widget;
    private readonly icon: St.Icon;
    private readonly badge: St.Label;
    private active = false;
    private colors = DEFAULT_COLORS;

    /** `icon` is a name for iconFor, or an icon. */
    constructor(
        icon: string | Gio.Icon,
        label: string,
        private readonly tone: string,
        onClick: () => void,
    ) {
        this.circle = new St.Widget({
            style_class: 'nokta-tile-circle',
            layout_manager: new OverlayLayout(),
            width: TILE_SIZE,
            height: TILE_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.icon = new St.Icon({
            style_class: 'nokta-tile-icon',
            gicon: typeof icon === 'string' ? iconFor(icon) : icon,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.circle.add_child(this.icon);
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
        this.badge.style = `background-color: ${this.tone}; color: ${onTone(this.tone)};`;
        this.repaint();
    }

    private repaint(): void {
        paint(this.circle, this.icon, this.active, this.actor.hover, this.tone, this.colors);
    }
}
