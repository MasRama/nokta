import { batteryFill, batteryTone } from '@ext/features/osd/logic/battery.js';
import type { OsdContent } from '@ext/features/osd/logic/content.js';
import type { AlertMotion } from '@ext/shared/logic/alert-motion.js';
import { withAlpha } from '@ext/shared/logic/color.js';
import { FILL_MS, POP, POP_MS, RING, RING_STEP_MS, SLIDE, SWEEP } from '@ext/shared/logic/keyframes.js';

import { icon, setIcon } from '../icons.js';

const ICON_SIZE = 16;
const BAR_EASE_MS = 100;
/** The width inside the battery's 22 px outline, its 1 px border and 1 px padding. */
const BATTERY_INNER = 18;
const EASE_OUT_CUBIC = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Plays `frames` on `element` where the page can animate; nothing in tests. */
function play(element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
    return typeof element.animate === 'function' ? element.animate(frames, options) : null;
}

/** The OSD row, as the extension's OsdView: icon, level bar, text, and a detail on the right. */
export class OsdView {
    readonly element: HTMLDivElement;
    private readonly icon: HTMLSpanElement;
    private readonly track: HTMLDivElement;
    private readonly fill: HTMLDivElement;
    private readonly label: HTMLSpanElement;
    private readonly battery: HTMLDivElement;
    private readonly batteryCase: HTMLDivElement;
    private readonly batteryNub: HTMLDivElement;
    private readonly batteryFill: HTMLDivElement;
    private readonly detail: HTMLSpanElement;
    private motions: Animation[] = [];

    constructor() {
        const div = (className: string): HTMLDivElement => {
            const element = document.createElement('div');
            element.className = className;
            return element;
        };
        this.element = div('nokta-view nokta-osd');
        this.icon = icon('', ICON_SIZE);
        this.icon.classList.add('nokta-osd-icon');
        this.track = div('nokta-osd-track');
        // The fill covers the track and is scaled from its left edge.
        this.fill = div('nokta-osd-fill');
        this.track.append(this.fill);
        this.label = document.createElement('span');
        this.label.className = 'nokta-osd-text';
        this.batteryFill = div('nokta-osd-battery-fill');
        this.batteryCase = div('nokta-osd-battery-case');
        this.batteryCase.append(this.batteryFill);
        this.batteryNub = div('nokta-osd-battery-nub');
        this.battery = div('nokta-osd-battery');
        this.battery.append(this.batteryCase, this.batteryNub);
        this.detail = document.createElement('span');
        this.detail.className = 'nokta-osd-detail';
        this.element.append(this.icon, this.track, this.label, this.battery, this.detail);
    }

    setColors(fill: string, track: string): void {
        this.fill.style.backgroundColor = fill;
        this.track.style.backgroundColor = track;
        const outline = withAlpha(fill, 0.5);
        this.batteryCase.style.borderColor = outline;
        this.batteryNub.style.backgroundColor = outline;
    }

    /** `animate` eases the bar from its last value, for a change while shown. */
    show(content: OsdContent, iconName: string, animate: boolean, speed: number): void {
        this.stopMotion();
        setIcon(this.icon, iconName, ICON_SIZE);
        this.label.textContent = content.text;
        this.detail.textContent = content.detail ?? '';
        this.detail.hidden = !content.detail;
        const level = content.battery ?? null;
        this.battery.hidden = level === null;
        if (level !== null) {
            this.batteryFill.style.width = `${batteryFill(level, BATTERY_INNER)}px`;
            this.batteryFill.hidden = level <= 0;
            this.batteryFill.style.backgroundColor = batteryTone(level);
        }
        this.element.classList.toggle('nokta-osd-urgent', Boolean(content.urgent));
        const hasBar = content.fraction !== null;
        this.track.hidden = !hasBar;
        this.label.classList.toggle('nokta-osd-text-only', !hasBar);
        const ms = animate && !reducedMotion() ? Math.round(BAR_EASE_MS * speed) : 0;
        this.fill.style.transition = ms ? `transform ${ms}ms ease-out` : 'none';
        this.fill.style.transform = `scaleX(${content.fraction ?? 0})`;
    }

    /**
     * The alert's own motion, after `show`: the icon slides in, rings or
     * pops; the battery fills up or sweeps once. Each ends where the row rests.
     */
    playMotion(motion: AlertMotion, speed: number): void {
        if (reducedMotion()) return;
        const ms = (value: number): number => Math.round(value * speed);
        // From rest through each of `values`, `stepMs` apiece.
        const steps = (values: readonly number[], stepMs: number, frame: (value: number) => Keyframe) =>
            play(this.icon, [0, ...values].map(frame), { duration: ms(stepMs * values.length) });
        let animation: Animation | null = null;
        switch (motion) {
            case 'slide':
                animation = play(
                    this.icon,
                    [
                        { transform: `translateX(${SLIDE.from}px)`, opacity: 0 },
                        { transform: 'none', opacity: 1 },
                    ],
                    { duration: ms(SLIDE.ms), easing: EASE_OUT_CUBIC },
                );
                break;
            case 'ring':
                // Swings from near its top, like a bell.
                this.icon.style.transformOrigin = '50% 15%';
                animation = steps(RING, RING_STEP_MS, (deg) => ({ transform: `rotate(${deg}deg)` }));
                break;
            case 'pop': {
                const [from, peak, rest] = POP;
                this.icon.style.transformOrigin = '50% 50%';
                const total = POP_MS[0] + POP_MS[1];
                animation = play(
                    this.icon,
                    [
                        { transform: `scale(${from})` },
                        { transform: `scale(${peak})`, offset: POP_MS[0] / total },
                        { transform: `scale(${rest})` },
                    ],
                    { duration: ms(total) },
                );
                break;
            }
            case 'fill':
                animation = play(this.batteryFill, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
                    duration: ms(FILL_MS),
                    easing: EASE_OUT_CUBIC,
                });
                break;
            case 'sweep':
                animation = play(this.batteryFill, [{ opacity: 1 }, { opacity: SWEEP.to / 255 }, { opacity: 1 }], {
                    duration: ms(SWEEP.ms * 2),
                    easing: 'ease-in-out',
                });
                break;
            default:
                break;
        }
        if (animation) this.motions.push(animation);
    }

    /** A new alert first stops the last one's motion and puts the row back at rest. */
    private stopMotion(): void {
        this.motions.forEach((animation) => animation.cancel());
        this.motions = [];
    }
}
