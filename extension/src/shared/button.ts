import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { withAlpha } from './logic/color.js';

const BUTTON_ALPHA = 0.12;
const BUTTON_HOVER_ALPHA = 0.22;

/**
 * A rounded button with an icon and a label, tinted from the foreground
 * color. `styleClass` names it in the stylesheet; its box, icon and label
 * take the same name with -box, -icon and -label.
 */
export class TintedButton {
    readonly actor: St.Button;
    private readonly label: St.Label;
    private foreground = '#ffffff';
    private readonly hoverId: number;
    private readonly clickId: number;

    constructor(styleClass: string, iconName: string, onClick: () => void) {
        const box = new St.BoxLayout({ style_class: `${styleClass}-box` });
        box.add_child(
            new St.Icon({
                style_class: `${styleClass}-icon`,
                gicon: new Gio.ThemedIcon({ name: iconName }),
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        this.label = new St.Label({ style_class: `${styleClass}-label`, y_align: Clutter.ActorAlign.CENTER });
        box.add_child(this.label);
        this.actor = new St.Button({ style_class: styleClass, child: box, x_expand: true });
        this.hoverId = this.actor.connect('notify::hover', () => this.paint());
        this.clickId = this.actor.connect('clicked', onClick);
        this.paint();
    }

    set text(text: string) {
        this.label.text = text;
    }

    setForeground(color: string): void {
        this.foreground = color;
        this.paint();
    }

    destroy(): void {
        this.actor.disconnect(this.hoverId);
        this.actor.disconnect(this.clickId);
    }

    private paint(): void {
        const alpha = this.actor.hover ? BUTTON_HOVER_ALPHA : BUTTON_ALPHA;
        this.actor.style = `background-color: ${withAlpha(this.foreground, alpha)};`;
    }
}
