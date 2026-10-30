import type Clutter from 'gi://Clutter';

import { ActivityBadge } from './features/activities/index.js';
import { CountdownBadge } from './features/calendar/index.js';
import { CallLabel, RecordingLabel } from './features/privacy/index.js';
import { ShelfBadge } from './features/shelf/index.js';
import { TimerLabel } from './features/timer/index.js';
import { type Indicator, INDICATOR_SLOTS, type IndicatorSlot, slotFor } from './shared/logic/indicator.js';

/** One widget for each kind of indicator. */
export interface IndicatorSet {
    recording: RecordingLabel;
    call: CallLabel;
    timer: TimerLabel;
    badge: ActivityBadge;
    shelf: ShelfBadge;
    countdown: CountdownBadge;
}

function newSet(): IndicatorSet {
    return {
        recording: new RecordingLabel(),
        call: new CallLabel(),
        timer: new TimerLabel(),
        badge: new ActivityBadge(),
        shelf: new ShelfBadge(),
        countdown: new CountdownBadge(),
    };
}

/**
 * The closed notch's indicator widgets: one set in place of the clock while
 * idle, one beside the cover while playing. Both always show the same
 * content; destroy() removes them all.
 */
export class IndicatorWidgets {
    readonly idle = newSet();
    readonly collapsed = newSet();

    /** Draws the same content in both sets. */
    each(draw: (set: IndicatorSet) => void): void {
        draw(this.idle);
        draw(this.collapsed);
    }

    /** The idle set's actors, in the order they sit over the clock. */
    idleActors(): Clutter.Actor[] {
        return INDICATOR_SLOTS.map((slot) => this.idle[slot].actor);
    }

    /** Shows only the idle widget for `indicator`; none for null. */
    showIdle(indicator: Indicator | null): void {
        const shown: IndicatorSlot | null = indicator && slotFor(indicator);
        for (const slot of INDICATOR_SLOTS) this.idle[slot].actor.visible = slot === shown;
    }

    /** The widget that draws `indicator` in `set`. */
    actorFor(set: IndicatorSet, indicator: Indicator): Clutter.Actor {
        return set[slotFor(indicator)].actor;
    }

    destroy(): void {
        this.each((set) => {
            for (const slot of INDICATOR_SLOTS) set[slot].destroy();
        });
    }
}
