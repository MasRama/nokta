import { formatClock } from '@ext/shared/logic/format.js';

/** The closed notch without a player: the clock, if `[behavior] show_clock`. */
export class IdleView {
    readonly element: HTMLDivElement;
    private readonly clock: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-idle';
        this.clock = document.createElement('span');
        this.clock.className = 'nokta-clock';
        this.element.append(this.clock);
    }

    update(now: Date, use24h: boolean, showClock: boolean): void {
        this.clock.textContent = formatClock(now, use24h);
        this.clock.hidden = !showClock;
    }
}
