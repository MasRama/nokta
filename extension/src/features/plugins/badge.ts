import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type { PluginCard } from './logic/plugins.js';
import { iconFor } from '../../shared/icons.js';

/** A plugin's badge in the closed notch: its icon in the card's tone and a few characters. */
export class PluginBadge {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly label: St.Label;

    constructor() {
        this.icon = new St.Icon({ style_class: 'nokta-plugin-badge-icon', y_align: Clutter.ActorAlign.CENTER });
        this.label = new St.Label({ style_class: 'nokta-plugin-badge-label', y_align: Clutter.ActorAlign.CENTER });
        this.actor = new St.BoxLayout({
            style_class: 'nokta-plugin-badge',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this.icon);
        this.actor.add_child(this.label);
    }

    update(card: PluginCard): void {
        this.icon.gicon = iconFor(card.icon);
        this.icon.style = `color: ${card.color};`;
        this.label.text = card.badge;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
