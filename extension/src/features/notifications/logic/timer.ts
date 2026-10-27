import type { Scheduler } from '../../../shared/logic/machine.js';

/** How long a notification stays after the pointer leaves it. */
export const LEAVE_MS = 1500;

/**
 * Whether a notification is on screen. show() turns it on for a while, or
 * restarts the time; the pointer on the notch keeps it on, and it ends a
 * moment after the pointer leaves.
 */
export class NotificationTimer {
    active = false;
    private inside = false;
    private cancelTimer: (() => void) | null = null;

    constructor(
        private readonly schedule: Scheduler,
        private readonly onChange: (active: boolean) => void,
    ) {}

    show(ms: number): void {
        this.clearTimer();
        if (!this.inside) this.startTimer(ms);
        if (this.active) return;
        this.active = true;
        this.onChange(true);
    }

    pointer(inside: boolean): void {
        if (inside === this.inside) return;
        this.inside = inside;
        if (!this.active) return;
        this.clearTimer();
        if (!inside) this.startTimer(LEAVE_MS);
    }

    hide(): void {
        this.clearTimer();
        if (!this.active) return;
        this.active = false;
        this.onChange(false);
    }

    destroy(): void {
        this.clearTimer();
    }

    private startTimer(ms: number): void {
        this.cancelTimer = this.schedule(ms, () => {
            this.cancelTimer = null;
            this.hide();
        });
    }

    private clearTimer(): void {
        this.cancelTimer?.();
        this.cancelTimer = null;
    }
}
