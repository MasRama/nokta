import { TIMER_PRESETS } from '@ext/features/timer/logic/clocks.js';
import { format, _ } from '@ext/shared/logic/i18n.js';
import { withAlpha } from '@ext/shared/logic/color.js';

import { icon, setIcon } from '../icons.js';
import { IconChip } from './controls.js';

/** The time left, after a dot in the phase's colour; dimmed while paused. */
export class TimerLabel {
    readonly element: HTMLSpanElement;
    private readonly dot: HTMLSpanElement;
    private readonly time: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('span');
        this.element.className = 'nokta-timer-box';
        this.dot = document.createElement('span');
        this.dot.className = 'nokta-timer-dot';
        this.time = document.createElement('span');
        this.time.className = 'nokta-timer';
        this.element.append(this.dot, this.time);
    }

    update(text: string, color: string, paused: boolean): void {
        this.time.textContent = text;
        this.dot.style.backgroundColor = color;
        this.element.style.opacity = paused ? '0.5' : '';
    }
}

/** A countdown, stopwatch or alarm, as one row of home shows it. */
export interface HomeClock {
    id: string;
    /** Nokta's icon name. */
    icon: string;
    color: string;
    title: string;
    /** Shown dimmed after the title, like `Paused · 10 min`. */
    detail: string;
    /** Like `4:59`. */
    time: string;
    running: boolean;
    /** False for an alarm, which only goes off or is removed. */
    canPause: boolean;
}

export interface ClockHandlers {
    pauseClock(id: string, pause: boolean): void;
    removeClock(id: string): void;
}

/** One clock: its icon chip in the kind's colour, title, detail, time, and pause and remove buttons. */
export class ClockRow {
    readonly element: HTMLDivElement;
    readonly chip = new IconChip();
    private readonly title: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;
    private readonly time: HTMLSpanElement;
    private readonly pause: HTMLButtonElement;
    private readonly pauseIcon: HTMLSpanElement;
    private clock: HomeClock | null = null;

    constructor(handlers: ClockHandlers) {
        const span = (className: string): HTMLSpanElement => {
            const element = document.createElement('span');
            element.className = className;
            return element;
        };
        this.title = span('nokta-panel-clock-title');
        this.detail = span('nokta-panel-clock-detail');
        this.time = span('nokta-panel-clock-time');
        this.pauseIcon = icon('pause', 14);
        this.pause = document.createElement('button');
        this.pause.className = 'nokta-button';
        this.pause.append(this.pauseIcon);
        this.pause.addEventListener('click', () => {
            if (this.clock) handlers.pauseClock(this.clock.id, this.clock.running);
        });
        const remove = document.createElement('button');
        remove.className = 'nokta-button';
        remove.append(icon('close', 14));
        remove.addEventListener('click', () => {
            if (this.clock) handlers.removeClock(this.clock.id);
        });
        this.element = document.createElement('div');
        this.element.className = 'nokta-panel-clock';
        this.element.hidden = true;
        this.element.append(this.chip.element, this.title, this.detail, this.time, this.pause, remove);
    }

    show(clock: HomeClock | undefined): void {
        this.clock = clock ?? null;
        this.element.hidden = clock === undefined;
        if (!clock) return;
        this.chip.show(clock.icon, clock.color);
        this.title.textContent = clock.title;
        this.detail.textContent = clock.detail;
        this.time.textContent = clock.time;
        this.time.style.opacity = clock.running ? '' : '0.5';
        this.pause.hidden = !clock.canPause;
        this.pause.setAttribute('aria-label', clock.running ? 'Pause' : 'Resume');
        setIcon(this.pauseIcon, clock.running ? 'pause' : 'play', 14);
    }
}

export interface TimerPageHandlers {
    countdown(minutes: number): void;
    stopwatch(): void;
}

const IDLE_ALPHA = 0.12;
const HOVER_ALPHA = 0.22;
const COLUMNS = 4;

/**
 * The timer page's body: a button per preset length and one for a
 * stopwatch, four to a row. What they start shows in home and the closed
 * notch. As the extension's timer/page.ts.
 */
export class TimerPage {
    readonly element: HTMLDivElement;
    /** Two rows of buttons 32 px high, 6 apart. */
    static readonly HEIGHT = 2 * 32 + 6;
    private readonly buttons: HTMLButtonElement[] = [];
    private foreground = '#ffffff';

    constructor(handlers: TimerPageHandlers) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-timer-page';
        for (const minutes of TIMER_PRESETS) {
            this.button(format(_('%d min'), minutes), () => handlers.countdown(minutes));
        }
        const stopwatch = this.button(_('Stopwatch'), () => handlers.stopwatch());
        stopwatch.prepend(icon('play', 14));
        stopwatch.style.gridColumn = `span ${COLUMNS - (TIMER_PRESETS.length % COLUMNS)}`;
    }

    setColors({ foreground }: { foreground: string }): void {
        this.foreground = foreground;
        for (const button of this.buttons) this.paint(button, false);
    }

    private button(text: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'nokta-timer-preset';
        button.append(text);
        button.addEventListener('click', onClick);
        button.addEventListener('pointerenter', () => this.paint(button, true));
        button.addEventListener('pointerleave', () => this.paint(button, false));
        this.buttons.push(button);
        this.element.append(button);
        this.paint(button, false);
        return button;
    }

    private paint(button: HTMLButtonElement, hover: boolean): void {
        button.style.backgroundColor = withAlpha(this.foreground, hover ? HOVER_ALPHA : IDLE_ALPHA);
        button.style.color = this.foreground;
    }
}
