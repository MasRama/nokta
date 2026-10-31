import { formatClock } from '@ext/shared/logic/format.js';

/**
 * The closed notch without a player: the clock, if `[behavior] show_clock`,
 * or in its place an indicator such as the call.
 */
export class IdleView {
    readonly element: HTMLDivElement;
    private readonly clock: HTMLSpanElement;
    private aside: HTMLElement | null = null;
    private showClock = true;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-idle';
        this.clock = document.createElement('span');
        this.clock.className = 'nokta-clock';
        this.element.append(this.clock);
    }

    update(now: Date, use24h: boolean, showClock: boolean): void {
        this.clock.textContent = formatClock(now, use24h);
        this.showClock = showClock;
        this.clock.hidden = !showClock || this.aside !== null;
    }

    /** Shows `element` in the clock's place; null brings the clock back. */
    setAside(element: HTMLElement | null): void {
        if (element === this.aside) return;
        this.aside?.remove();
        this.aside = element;
        if (element) this.element.append(element);
        this.clock.hidden = !this.showClock || element !== null;
    }
}
