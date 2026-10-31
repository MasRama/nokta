import type { Line } from '@ext/shared/logic/progress-line.js';

/**
 * A 2 px line along the closed notch's bottom edge, inset by the corner
 * radius. It fills with one linear transition to its end, like the
 * extension's, and starts again on each change; no timer.
 */
export class ProgressLine {
    readonly element: HTMLDivElement;
    private readonly fill: HTMLDivElement;

    constructor() {
        this.fill = document.createElement('div');
        this.fill.className = 'nokta-progress-line-fill';
        this.element = document.createElement('div');
        this.element.className = 'nokta-progress-line';
        this.element.append(this.fill);
        this.element.hidden = true;
    }

    /** Null hides it. */
    show(line: Line | null, color: string, cornerRadius: number): void {
        const fill = this.fill.style;
        fill.transition = 'none';
        if (!line) {
            this.element.hidden = true;
            return;
        }
        this.element.style.left = this.element.style.right = `${cornerRadius}px`;
        fill.background = color;
        fill.transform = `scaleX(${line.fraction})`;
        this.element.hidden = false;
        if (!line.msToEnd) return;
        // Read the layout so the transition starts from the fraction just set.
        void this.fill.offsetWidth;
        fill.transition = `transform ${Math.round(line.msToEnd)}ms linear`;
        fill.transform = 'scaleX(1)';
    }
}
