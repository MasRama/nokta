import { defaultSeat } from '../../shared/compat.js';

export type LockKey = 'Caps Lock' | 'Num Lock';

/** Calls `onChange` when Caps Lock or Num Lock turns on or off; never for the start state. */
export class LockKeysWatcher {
    private readonly keymap = defaultSeat().get_keymap();
    private readonly changedId: number;
    private caps: boolean;
    private num: boolean;

    constructor(onChange: (key: LockKey, on: boolean) => void) {
        this.caps = this.keymap.get_caps_lock_state();
        this.num = this.keymap.get_num_lock_state();
        // state-changed also fires for layout changes.
        this.changedId = this.keymap.connect('state-changed', () => {
            const caps = this.keymap.get_caps_lock_state();
            const num = this.keymap.get_num_lock_state();
            if (caps !== this.caps) {
                this.caps = caps;
                onChange('Caps Lock', caps);
            }
            if (num !== this.num) {
                this.num = num;
                onChange('Num Lock', num);
            }
        });
    }

    destroy(): void {
        this.keymap.disconnect(this.changedId);
    }
}
