import { TOUR_STEPS, type TourStep } from '@ext/features/tour/logic/steps.js';
import { withAlpha } from '@ext/shared/logic/color.js';
import { _ } from '@ext/shared/logic/i18n.js';

export interface TourPresses {
    next(): void;
    skip(): void;
    openSettings(): void;
}

export interface TourColors {
    foreground: string;
    accent: string;
    onAccent: string;
}

/**
 * The first-run tour in the open notch: a row of dots for the step, its
 * text, Skip and Next. As the extension's tour/view.ts.
 */
export class TourView {
    readonly element: HTMLDivElement;
    private readonly dots: HTMLSpanElement[] = [];
    private readonly title: HTMLDivElement;
    private readonly body: HTMLDivElement;
    private readonly skip: HTMLButtonElement;
    private readonly settings: HTMLButtonElement;
    private readonly next: HTMLButtonElement;
    private colors: TourColors = { foreground: '#ffffff', accent: '#ffffff', onAccent: '#000000' };
    private step = 0;

    constructor(presses: TourPresses) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-tour';
        const dots = document.createElement('div');
        dots.className = 'nokta-tour-dots';
        for (let i = 0; i < TOUR_STEPS; i++) {
            const dot = document.createElement('span');
            dot.className = 'nokta-tour-dot';
            this.dots.push(dot);
            dots.append(dot);
        }
        this.title = document.createElement('div');
        this.title.className = 'nokta-tour-title';
        this.body = document.createElement('div');
        this.body.className = 'nokta-tour-body';

        const button = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
            const b = document.createElement('button');
            b.className = className;
            b.type = 'button';
            b.textContent = text;
            b.addEventListener('click', onClick);
            return b;
        };
        this.skip = button('nokta-tour-skip', _('Skip'), () => presses.skip());
        this.settings = button('nokta-tour-settings', _('Open settings'), () => presses.openSettings());
        this.next = button('nokta-tour-next', _('Next'), () => presses.next());
        const buttons = document.createElement('div');
        buttons.className = 'nokta-tour-buttons';
        buttons.append(this.skip, this.settings, this.next);

        this.element.append(dots, this.title, this.body, buttons);
    }

    /** Shows step `index`. */
    show(step: TourStep, index: number): void {
        this.step = index;
        this.title.textContent = step.title;
        this.body.textContent = step.body;
        this.next.textContent = step.last ? _('Done') : _('Next');
        this.settings.hidden = !step.settings;
        this.paintDots();
    }

    /** Next takes the keyboard, so Enter goes on; the notch, still growing, does not scroll to it. */
    focusNext(): void {
        this.next.focus({ preventScroll: true });
    }

    setColors(colors: TourColors): void {
        this.colors = colors;
        const { foreground, accent, onAccent } = colors;
        this.element.style.setProperty('--nokta-tint', withAlpha(foreground, 0.12));
        this.element.style.setProperty('--nokta-tint-hover', withAlpha(foreground, 0.22));
        this.next.style.backgroundColor = accent;
        this.next.style.color = onAccent;
        this.skip.style.color = withAlpha(foreground, 0.7);
        this.paintDots();
    }

    /** The step's dot is a longer one in the accent. */
    private paintDots(): void {
        const { foreground, accent } = this.colors;
        this.dots.forEach((dot, i) => {
            const now = i === this.step;
            dot.style.width = `${now ? 16 : 6}px`;
            dot.style.backgroundColor = now ? accent : withAlpha(foreground, 0.3);
        });
    }
}
