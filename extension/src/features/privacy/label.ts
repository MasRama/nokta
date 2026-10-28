import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { CALL_COLORS, RECORDING_COLOR } from './logic/call.js';

/** The closed notch's call: a microphone, red while muted, and how long it has been on. */
export class CallLabel {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly label: St.Label;

    constructor() {
        this.icon = new St.Icon({ style_class: 'nokta-call-icon', y_align: Clutter.ActorAlign.CENTER });
        this.label = new St.Label({ style_class: 'nokta-call-time', y_align: Clutter.ActorAlign.CENTER });
        this.actor = new St.BoxLayout({
            style_class: 'nokta-call',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this.icon);
        this.actor.add_child(this.label);
    }

    update(text: string, muted: boolean): void {
        this.label.text = text;
        this.icon.icon_name = muted ? 'microphone-disabled-symbolic' : 'audio-input-microphone-symbolic';
        this.icon.style = `color: ${muted ? CALL_COLORS.muted : CALL_COLORS.live};`;
    }

    destroy(): void {
        this.actor.destroy();
    }
}

/** The closed notch's screen recording: a red dot and how long it has run. */
export class RecordingLabel {
    readonly actor: St.BoxLayout;
    private readonly label: St.Label;

    constructor() {
        const dot = new St.Widget({ style_class: 'nokta-recording-dot', y_align: Clutter.ActorAlign.CENTER });
        dot.style = `background-color: ${RECORDING_COLOR};`;
        this.label = new St.Label({ style_class: 'nokta-call-time', y_align: Clutter.ActorAlign.CENTER });
        this.actor = new St.BoxLayout({
            style_class: 'nokta-recording',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(dot);
        this.actor.add_child(this.label);
    }

    update(text: string): void {
        this.label.text = text;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
