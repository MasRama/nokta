import { CALENDAR_ICON } from '@ext/features/calendar/logic/events.js';
import { withAlpha } from '@ext/shared/logic/color.js';
import { _ } from '@ext/shared/logic/i18n.js';
import { TONES } from '@ext/shared/logic/tones.js';

import { icon } from '../icons.js';

/** An event in home's agenda, as the extension's PanelEvent. */
export interface HomeEvent {
    id: string;
    /** Its start, as the clock shows times. */
    time: string;
    title: string;
    /** `in 25 min`, `Tomorrow`, both or empty, dimmed after the title. */
    detail: string;
    /** Its calendar's `#rrggbb`; null uses the calendar tone. */
    color: string | null;
    /** It has a meeting link, for its Join button. */
    joinable: boolean;
}

export interface EventHandlers {
    /** Opens the event's calendar. */
    openEvent(id: string): void;
    /** Opens the event's meeting link. */
    joinMeeting(id: string): void;
}

/**
 * An event in one line: a strip in its calendar's color, its time, the
 * title, then how soon, dimmed, and a Join button for a meeting. A click
 * opens the calendar. As the extension's panel/view.ts EventRow.
 */
export class EventRow {
    readonly element: HTMLDivElement;
    private readonly strip: HTMLSpanElement;
    private readonly time: HTMLSpanElement;
    private readonly title: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;
    private readonly join: HTMLButtonElement;
    private id = '';

    constructor(handlers: EventHandlers) {
        this.strip = document.createElement('span');
        this.strip.className = 'nokta-panel-event-strip';
        this.time = document.createElement('span');
        this.time.className = 'nokta-panel-event-time';
        this.title = document.createElement('span');
        this.title.className = 'nokta-panel-event-title';
        this.detail = document.createElement('span');
        this.detail.className = 'nokta-panel-event-when';
        const main = document.createElement('button');
        main.className = 'nokta-button nokta-panel-event-main';
        main.append(this.strip, this.time, this.title, this.detail);
        main.addEventListener('click', () => handlers.openEvent(this.id));
        this.join = document.createElement('button');
        this.join.className = 'nokta-button nokta-panel-join';
        this.join.textContent = _('Join');
        this.join.style.backgroundColor = withAlpha(TONES.calendar, 0.22);
        this.join.style.color = TONES.calendar;
        this.join.addEventListener('click', () => handlers.joinMeeting(this.id));
        this.element = document.createElement('div');
        this.element.className = 'nokta-panel-event';
        this.element.hidden = true;
        this.element.append(main, this.join);
    }

    show(event: HomeEvent | undefined): void {
        this.element.hidden = event === undefined;
        if (!event) return;
        this.id = event.id;
        this.time.textContent = event.time;
        this.title.textContent = event.title;
        this.title.title = event.title;
        this.detail.textContent = event.detail;
        this.detail.hidden = event.detail === '';
        this.join.hidden = !event.joinable;
        this.strip.style.backgroundColor = event.color ?? TONES.calendar;
    }
}

/** The closed notch's countdown to a meeting: a calendar icon and `5 min`, ..., `Now`. */
export class CountdownBadge {
    readonly element: HTMLSpanElement;
    private readonly label: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('span');
        this.element.className = 'nokta-countdown';
        const glyph = icon(CALENDAR_ICON, 14);
        glyph.style.color = TONES.calendar;
        this.label = document.createElement('span');
        this.label.className = 'nokta-countdown-label';
        this.element.append(glyph, this.label);
    }

    update(text: string): void {
        this.label.textContent = text;
    }
}
