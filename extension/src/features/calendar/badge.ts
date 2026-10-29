import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { iconFor } from '../../shared/icons.js';
import { TONES } from '../../shared/logic/tones.js';
import { CALENDAR_ICON } from './logic/events.js';

/** The closed notch's countdown to a meeting: a calendar icon and `5 min`, ..., `Now`. */
export class CountdownBadge {
    readonly actor: St.BoxLayout;
    private readonly label: St.Label;

    constructor() {
        const icon = new St.Icon({
            gicon: iconFor(CALENDAR_ICON),
            style_class: 'nokta-countdown-icon',
            style: `color: ${TONES.calendar};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.label = new St.Label({ style_class: 'nokta-countdown-label', y_align: Clutter.ActorAlign.CENTER });
        this.actor = new St.BoxLayout({
            style_class: 'nokta-countdown',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(icon);
        this.actor.add_child(this.label);
    }

    update(text: string): void {
        this.label.text = text;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
