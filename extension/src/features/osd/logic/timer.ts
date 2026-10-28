import type { Scheduler } from '../../../shared/logic/machine.js';

/**
 * Whether the OSD is on screen. show() turns it on, or keeps it on
 * and restarts the countdown; it turns off after the duration with no new
 * show(), or at once with hide().
 */
export class OsdTimer {
    active = false;
    private cancelTimer: (() => void) | null = null;

    constructor(
        private readonly schedule: Scheduler,
        private readonly durationMs: () => number,
        private readonly onChange: (active: boolean) => void,
    ) {}

    /** `ms` replaces the usual duration for this show. */
    show(ms?: number): void {
        this.clearTimer();
        this.cancelTimer = this.schedule(ms ?? this.durationMs(), () => {
            this.cancelTimer = null;
            this.hide();
        });
        if (this.active) return;
        this.active = true;
        this.onChange(true);
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

    private clearTimer(): void {
        this.cancelTimer?.();
        this.cancelTimer = null;
    }
}
