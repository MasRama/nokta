import { BAR_COUNT, barLevels, barsFrom, easeBars, RAMP_MS, rampLevels } from '@ext/features/media/logic/equalizer.js';

/** The music's band levels from 0 to 1 when the core hears them, else null. */
export type LevelSource = () => readonly number[] | null;

/** Heights the bars rest at while paused, as the extension's. */
const REST = [0.45, 0.75, 0.55, 0.35];

/** About 12 steps a second, as the extension's. */
const STEP_MS = 83;

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Four bars stepped like a level meter while music plays: a playback
 * indicator. They follow the music's bands when there are any, else the
 * extension's pattern. A CSS transition eases each step, and their fall to
 * rest when the music stops.
 */
export class Equalizer {
    readonly element: HTMLDivElement;
    private readonly bars: HTMLDivElement[] = [];
    private shown: readonly number[] = REST;
    private timer = 0;
    private startedMs = 0;

    constructor(private readonly levels: LevelSource) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-equalizer';
        for (let i = 0; i < BAR_COUNT; i++) {
            const bar = document.createElement('div');
            bar.className = 'nokta-equalizer-bar';
            this.element.append(bar);
            this.bars.push(bar);
        }
        this.show(REST);
    }

    setColor(color: string): void {
        for (const bar of this.bars) bar.style.backgroundColor = color;
    }

    setPlaying(playing: boolean): void {
        const animate = playing && !reducedMotion();
        if (animate && !this.timer) {
            this.startedMs = performance.now();
            this.element.classList.remove('nokta-equalizer-settling');
            this.timer = window.setInterval(() => {
                const nowMs = performance.now();
                const levels = this.levels();
                const target = levels ? easeBars(this.shown, barsFrom(levels)) : barLevels(nowMs);
                this.show(rampLevels(target, nowMs - this.startedMs, RAMP_MS, REST));
            }, STEP_MS);
        } else if (!animate && this.timer) {
            window.clearInterval(this.timer);
            this.timer = 0;
            this.element.classList.add('nokta-equalizer-settling');
            this.show(REST);
        }
    }

    destroy(): void {
        window.clearInterval(this.timer);
        this.timer = 0;
    }

    private show(levels: readonly number[]): void {
        this.shown = levels;
        this.bars.forEach((bar, i) => (bar.style.transform = `scaleY(${levels[i]})`));
    }
}
