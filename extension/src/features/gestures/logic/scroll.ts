/** What a scroll on the notch does. */
export type ScrollAction = 'volume-up' | 'volume-down' | 'next' | 'previous';

export type ScrollDiscrete = 'up' | 'down' | 'left' | 'right';

/** A swipe ends after this long without a scroll event. */
export const SWIPE_GAP_MS = 300;
/** Smooth scroll units sideways that make a swipe skip a song. */
const SWIPE_DISTANCE = 2;

/**
 * Turns scroll events into actions: up and down step the volume per wheel
 * click or per unit of smooth scrolling; one swipe sideways (left: next,
 * right: previous) skips at most one song. Each smooth event counts on the
 * axis it moves most along.
 */
export class ScrollTracker {
    private lastMs = -Infinity;
    private dy = 0;
    private dx = 0;
    private swiped = false;

    /** `discrete` is a wheel click's direction, null for a smooth event with deltas `dx`, `dy`. */
    push(dx: number, dy: number, discrete: ScrollDiscrete | null, timeMs: number): ScrollAction | null {
        if (timeMs - this.lastMs > SWIPE_GAP_MS) {
            this.dx = 0;
            this.dy = 0;
            this.swiped = false;
        }
        this.lastMs = timeMs;
        switch (discrete) {
            case 'up':
                return 'volume-up';
            case 'down':
                return 'volume-down';
            case 'left':
                return this.swipe('next');
            case 'right':
                return this.swipe('previous');
        }
        if (Math.abs(dx) > Math.abs(dy)) {
            this.dx += dx;
            if (Math.abs(this.dx) < SWIPE_DISTANCE) return null;
            return this.swipe(this.dx < 0 ? 'next' : 'previous');
        }
        this.dy += dy;
        if (Math.abs(this.dy) < 1) return null;
        const up = this.dy < 0;
        this.dy += up ? 1 : -1;
        return up ? 'volume-up' : 'volume-down';
    }

    private swipe(action: 'next' | 'previous'): ScrollAction | null {
        if (this.swiped) return null;
        this.swiped = true;
        return action;
    }
}
