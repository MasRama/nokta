import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { PRESS_MS, PRESS_SCALE, pressState, pressTarget, RELEASE_MS } from './logic/press.js';

/**
 * Presses the notch's buttons in: one handler on the notch sees every
 * primary press first, so buttons made later get it too. The button shrinks
 * while St says it is pressed and springs back when it is not, or when the
 * pointer leaves it.
 */
export class PressFeedback {
    private readonly capturedId: number;
    private button: St.Button | null = null;
    private buttonIds: number[] = [];

    constructor(
        private readonly root: Clutter.Actor,
        private readonly speed: () => number,
    ) {
        this.capturedId = root.connect('captured-event', (_actor, event: Clutter.Event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS && event.get_button() === Clutter.BUTTON_PRIMARY)
                this.onPress(event.get_source());
            return Clutter.EVENT_PROPAGATE;
        });
    }

    /** Lets go of the pressed button, as when the notch changes view. */
    release(): void {
        if (!this.button) return;
        this.ease(this.button, pressState('close'));
        this.forget();
    }

    destroy(): void {
        this.forget();
        this.root.disconnect(this.capturedId);
    }

    private onPress(source: Clutter.Actor | null): void {
        const chain: Clutter.Actor[] = [];
        for (let actor = source; actor && actor !== this.root; actor = actor.get_parent()) chain.push(actor);
        const index = pressTarget(chain.map((actor) => actor instanceof St.Button));
        if (index < 0) return;
        const button = chain[index] as St.Button;
        if (button === this.button) return;
        this.release();
        this.button = button;
        this.buttonIds = [
            button.connect('notify::pressed', () => this.ease(button, pressState(button.pressed ? 'press' : 'release'))),
            button.connect('notify::hover', () => {
                if (!button.hover) this.ease(button, pressState('leave'));
            }),
            button.connect('destroy', () => this.forget()),
        ];
        this.ease(button, pressState('press'));
    }

    private ease(button: St.Button, pressed: boolean): void {
        if (!St.Settings.get().enable_animations) return;
        button.set_pivot_point(0.5, 0.5);
        button.remove_transition('scale-x');
        button.remove_transition('scale-y');
        const scale = pressed ? PRESS_SCALE : 1;
        button.ease({
            scale_x: scale,
            scale_y: scale,
            duration: Math.round((pressed ? PRESS_MS : RELEASE_MS) * this.speed()),
            mode: pressed ? Clutter.AnimationMode.EASE_OUT_QUAD : Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    private forget(): void {
        if (this.button) for (const id of this.buttonIds) this.button.disconnect(id);
        this.button = null;
        this.buttonIds = [];
    }
}
