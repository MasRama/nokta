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
 * delay, with or without a player. Leaving closes after the close delay;
 * coming back cancels that. A player that comes or goes while the pointer
 * is on the open notch keeps it open.
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
        if (this.mode === 'expanded') {
            if (this.inside) return;
            this.clearTimer();
        }
        // A pending open delay keeps running.
        this.go(this.closed());
    }

    pointer(inside: boolean): void {
        this.inside = inside;
        this.clearTimer();
        if (inside && this.mode !== 'expanded') {
            this.startTimer(this.delays().openMs, () => 'expanded');
        } else if (!inside && this.mode === 'expanded') {
            this.startTimer(this.delays().closeMs, () => this.closed());
        }
    }

    /** Closes the open notch, after a click on it; it opens again when the pointer comes back. */
    close(): void {
        this.clearTimer();
        this.go(this.closed());
    }

    destroy(): void {
        this.clearTimer();
    }

    /** The mode the notch rests in when not open. */
    private closed(): NotchMode {
        return this.available ? 'collapsed' : 'idle';
    }

    private startTimer(ms: number, target: () => NotchMode): void {
        this.cancelTimer = this.schedule(ms, () => {
            this.cancelTimer = null;
            this.go(target());
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
