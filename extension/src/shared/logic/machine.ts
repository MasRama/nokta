export type NotchMode = 'idle' | 'collapsed' | 'expanded';

/** Runs `fn` after `ms`; returns a function that cancels it. */
export type Scheduler = (ms: number, fn: () => void) => () => void;

/** The values `[behavior] open_on` takes: what opens the closed notch. */
export const OPEN_ON = ['hover', 'click'] as const;
export type OpenOn = (typeof OPEN_ON)[number];

export interface HoverDelays {
    openMs: number;
    closeMs: number;
    openOn: OpenOn;
}

/**
 * Which state the notch is in: Idle without a player,
 * Collapsed with one, Expanded after the pointer rests on it for the open
 * delay (or on a click, with `openOn` "click"), with or without a player.
 * Leaving closes after the close delay; coming back cancels that. A player
 * that comes or goes while the pointer is on the open notch keeps it open.
 * Opened held (from the keyboard), it stays open until close().
 */
export class NotchMachine {
    mode: NotchMode = 'idle';
    private available = false;
    private inside = false;
    private holding = false;
    private cancelTimer: (() => void) | null = null;

    constructor(
        private readonly schedule: Scheduler,
        private readonly delays: () => HoverDelays,
        private readonly onMode: (mode: NotchMode, previous: NotchMode) => void,
    ) {}

    /** Open from the keyboard: only close() closes it. */
    get held(): boolean {
        return this.holding;
    }

    setAvailable(available: boolean): void {
        this.available = available;
        if (this.mode === 'expanded') {
            if (this.inside || this.holding) return;
            this.clearTimer();
        }
        // A pending open delay keeps running.
        this.go(this.closed());
    }

    /** Where the pointer is; saying it again changes nothing, so a closed notch stays closed until it comes back. */
    pointer(inside: boolean): void {
        if (inside === this.inside) return;
        this.inside = inside;
        this.clearTimer();
        const delays = this.delays();
        if (inside && this.mode !== 'expanded') {
            if (delays.openOn === 'hover') this.startTimer(delays.openMs, () => 'expanded');
        } else if (!inside && this.mode === 'expanded' && !this.holding) {
            this.startTimer(delays.closeMs, () => this.closed());
        }
    }

    /**
     * A primary click on the closed notch: opens it at once with `openOn`
     * "click". False when the click is not the machine's.
     */
    click(): boolean {
        if (this.mode === 'expanded' || this.delays().openOn !== 'click') return false;
        this.open();
        return true;
    }

    /** Opens the notch at once; `hold` keeps it open until close(), whatever the pointer does. */
    open(hold = false): void {
        this.clearTimer();
        this.holding = hold;
        this.go('expanded');
    }

    /** Closes the open notch, after a click on it; it opens again when the pointer comes back. */
    close(): void {
        this.clearTimer();
        this.holding = false;
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
