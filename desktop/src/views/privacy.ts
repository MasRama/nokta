import { CALL_COLORS } from '@ext/features/privacy/logic/call.js';
import { DOT_COLORS, DOT_GAP, DOT_SIZE, dotsPlace, type Dot } from '@ext/features/privacy/logic/dots.js';

import { icon, setIcon } from '../icons.js';

/** A row of dots at the closed notch's left edge, over the idle and collapsed views. */
export class PrivacyDots {
    readonly element: HTMLDivElement;
    private shown = '';

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'nokta-privacy-dots';
        this.element.hidden = true;
    }

    /**
     * `height` and `cornerRadius` are the closed notch's. Returns where
     * content beside the dots may start, 0 without dots.
     */
    update(dots: readonly Dot[], height: number, cornerRadius: number): number {
        const place = dotsPlace(height, cornerRadius, dots.length);
        const key = `${dots.join()}@${height}/${cornerRadius}`;
        if (key === this.shown) return place.contentLeft;
        this.shown = key;
        this.element.replaceChildren(
            ...dots.map((dot) => {
                const el = document.createElement('span');
                el.className = 'nokta-privacy-dot';
                el.style.background = DOT_COLORS[dot];
                return el;
            }),
        );
        const style = this.element.style;
        style.gap = `${DOT_GAP}px`;
        style.left = `${place.left}px`;
        style.top = `${place.top}px`;
        style.setProperty('--nokta-dot', `${DOT_SIZE}px`);
        return place.contentLeft;
    }

    setVisible(visible: boolean): void {
        this.element.hidden = !visible;
    }
}

/** The closed notch's call: a microphone, red while muted, and how long it has been on. */
export class CallLabel {
    readonly element: HTMLSpanElement;
    private readonly icon = icon('mic', 14);
    private readonly time: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('span');
        this.element.className = 'nokta-call';
        this.time = document.createElement('span');
        this.time.className = 'nokta-call-time';
        this.element.append(this.icon, this.time);
    }

    update(text: string, muted: boolean): void {
        this.time.textContent = text;
        setIcon(this.icon, muted ? 'mic-off' : 'mic', 14);
        this.icon.style.color = muted ? CALL_COLORS.muted : CALL_COLORS.live;
    }
}
