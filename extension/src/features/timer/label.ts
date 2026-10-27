import Clutter from 'gi://Clutter';
import St from 'gi://St';

/** The time left, after a dot in the phase's color; dimmed while paused. */
export class TimerLabel {
    readonly actor: St.BoxLayout;
    private readonly dot: St.Widget;
    private readonly label: St.Label;

    constructor() {
        this.dot = new St.Widget({ style_class: 'nokta-timer-dot', y_align: Clutter.ActorAlign.CENTER });
        this.label = new St.Label({ style_class: 'nokta-timer', y_align: Clutter.ActorAlign.CENTER });
        this.actor = new St.BoxLayout({
            style_class: 'nokta-timer-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this.dot);
        this.actor.add_child(this.label);
    }

    update(text: string, color: string, paused: boolean): void {
        this.label.text = text;
        this.dot.style = `background-color: ${color};`;
        this.actor.opacity = paused ? 128 : 255;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
