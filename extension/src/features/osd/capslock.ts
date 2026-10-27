import { defaultSeat } from '../../shared/compat.js';

/** Calls `onChange` when Caps Lock turns on or off; never for the start state. */
export class CapsLockWatcher {
    private readonly keymap = defaultSeat().get_keymap();
    private readonly changedId: number;
    private on: boolean;

    constructor(onChange: (on: boolean) => void) {
        this.on = this.keymap.get_caps_lock_state();
        // state-changed also fires for Num Lock and layout changes.
        this.changedId = this.keymap.connect('state-changed', () => {
            const on = this.keymap.get_caps_lock_state();
            if (on === this.on) return;
            this.on = on;
            onChange(on);
        });
    }

    destroy(): void {
        this.keymap.disconnect(this.changedId);
    }
}
