import { formatClock } from '@ext/shared/logic/format.js';

import { notchPath, notchWidth } from './path.js';

const SVG = 'http://www.w3.org/2000/svg';

/** The `[appearance]` numbers the closed notch is drawn from. */
export interface IdleLook {
    width: number;
    height: number;
    radius: number;
    ear: number;
    background: string;
    foreground: string;
}

/**
 * The closed notch with the clock, centred at the top of the page. The clock
 * is set again on each minute boundary; nothing else runs.
 */
export class IdleNotch {
    readonly element: HTMLDivElement;
    private readonly shape: SVGPathElement;
    private readonly svg: SVGSVGElement;
    private readonly clock: HTMLSpanElement;
    private timer = 0;

    constructor(
        look: IdleLook,
        private readonly use24h: () => boolean,
    ) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-notch';
        this.svg = document.createElementNS(SVG, 'svg');
        this.shape = document.createElementNS(SVG, 'path');
        this.svg.append(this.shape);
        this.clock = document.createElement('span');
        this.clock.className = 'nokta-clock';
        this.element.append(this.svg, this.clock);
        this.setLook(look);
    }

    setLook(look: IdleLook): void {
        const width = notchWidth(look.width, look.ear);
        this.element.style.width = `${width}px`;
        this.element.style.height = `${look.height}px`;
        this.svg.setAttribute('width', String(width));
        this.svg.setAttribute('height', String(look.height));
        this.shape.setAttribute('d', notchPath(look.width, look.height, look.radius, look.ear));
        this.shape.setAttribute('fill', look.background);
        this.clock.style.color = look.foreground;
    }

    /** The notch's rectangle in the page. */
    rect(): { x: number; y: number; width: number; height: number } {
        const box = this.element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
    }

    start(now: () => Date = () => new Date()): void {
        const tick = () => {
            const date = now();
            this.clock.textContent = formatClock(date, this.use24h());
            const untilMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds());
            this.timer = window.setTimeout(tick, untilMinute);
        };
        tick();
    }

    stop(): void {
        window.clearTimeout(this.timer);
        this.timer = 0;
    }
}
