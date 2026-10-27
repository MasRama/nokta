export type NotchMode = 'idle' | 'collapsed' | 'expanded';

/** Runs `fn` after `ms`; returns a function that cancels it. */
export type Scheduler = (ms: number, fn: () => void) => () => void;

export interface HoverDelays {
    openMs: number;
    closeMs: number;
}

/**
 * Which state the notch is in (spec 6.2, 6.3): Idle without a player,
 * Collapsed with one, Expanded after the pointer rests on it for the open
 * delay. Leaving closes after the close delay; coming back cancels that.
 */
export class NotchMachine {
    mode: NotchMode = 'idle';
    private available = false;
    private inside = false;
    private cancelTimer: (() => void) | null = null;

    constructor(
        private readonly schedule: Scheduler,
        private readonly delays: () => HoverDelays,
        private readonly onMode: (mode: NotchMode, previous: NotchMode) => void,
    ) {}

    setAvailable(available: boolean): void {
        this.available = available;
        if (!available) {
            this.clearTimer();
            this.go('idle');
        } else if (this.mode === 'idle') {
            this.go('collapsed');
            if (this.inside) this.startTimer(this.delays().openMs, 'expanded');
        }
    }

    pointer(inside: boolean): void {
        this.inside = inside;
        this.clearTimer();
        if (inside && this.mode === 'collapsed') {
            this.startTimer(this.delays().openMs, 'expanded');
        } else if (!inside && this.mode === 'expanded') {
            this.startTimer(this.delays().closeMs, 'collapsed');
        }
    }

    destroy(): void {
        this.clearTimer();
    }

    private startTimer(ms: number, target: NotchMode): void {
        this.cancelTimer = this.schedule(ms, () => {
            this.cancelTimer = null;
            if (this.available) this.go(target);
        });
    }

    private clearTimer(): void {
        this.cancelTimer?.();
        this.cancelTimer = null;
    }

    private go(mode: NotchMode): void {
        if (mode === this.mode) return;
        const previous = this.mode;
        this.mode = mode;
        this.onMode(mode, previous);
    }
}
