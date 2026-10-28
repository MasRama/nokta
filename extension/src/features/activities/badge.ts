import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { activityIcon, progressLabel, type Activity } from './logic/activities.js';
import { iconFor } from '../../shared/icons.js';

const PULSE_MS = 900;

/**
 * The newest activity in the closed notch: its icon and the percentage, or
 * a slowly pulsing icon while the progress is unknown.
 */
export class ActivityBadge {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly label: St.Label;
    private unknown = false;
    private active = false;
    private pulsing = false;

    constructor() {
        this.icon = new St.Icon({ style_class: 'nokta-activity-badge-icon', y_align: Clutter.ActorAlign.CENTER });
        this.label = new St.Label({ style_class: 'nokta-activity-badge-label', y_align: Clutter.ActorAlign.CENTER });
        this.actor = new St.BoxLayout({
            style_class: 'nokta-activity-badge',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this.icon);
        this.actor.add_child(this.label);
    }

    update(activity: Activity): void {
        this.icon.gicon = iconFor(activityIcon(activity.icon));
        const label = progressLabel(activity.progress);
        this.label.text = label ?? '';
        this.label.visible = label !== null;
        this.unknown = label === null;
        this.pulse();
    }

    /** Pulses only while the badge is on screen. */
    setActive(active: boolean): void {
        this.active = active;
        this.pulse();
    }

    destroy(): void {
        this.active = false;
        this.pulse();
        this.actor.destroy();
    }

    private pulse(): void {
        const pulsing = this.active && this.unknown;
        if (pulsing === this.pulsing) return;
        this.pulsing = pulsing;
        this.icon.remove_all_transitions();
        this.icon.opacity = 255;
        if (!pulsing) return;
        this.icon.ease({
            opacity: 90,
            duration: PULSE_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: -1,
            autoReverse: true,
        });
    }
}
