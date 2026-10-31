import { eventColor, nextAlarm, type Alarm, type CalendarEvent } from '@ext/features/calendar/logic/events.js';
import { _ } from '@ext/shared/logic/i18n.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** An event of a calendar feed, with what the daemon answers on GNOME. */
export interface FeedEvent extends CalendarEvent {
    /** Its meeting link, or empty. */
    link: string;
    /** Its calendar's `#rrggbb`, or null. */
    color: string | null;
}

const DAY_MS = 24 * 60 * 60_000;

/** `Calendar1.Events` as events; an entry that is not one is left out. */
export function feedEventsFrom(raw: unknown): FeedEvent[] {
    if (!Array.isArray(raw)) return [];
    const out: FeedEvent[] = [];
    for (const item of raw as unknown[]) {
        if (item === null || typeof item !== 'object') continue;
        const { id, title, start, end, link, color } = item as Record<string, unknown>;
        if (typeof id !== 'string' || typeof start !== 'number' || typeof end !== 'number') continue;
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        out.push({
            id,
            title: typeof title === 'string' && title.trim() ? title.trim() : _('Untitled event'),
            startMs: start,
            endMs: end,
            link: typeof link === 'string' && link.startsWith('https://') ? link : '',
            color: eventColor(typeof color === 'string' ? color : null),
        });
    }
    return out;
}

/**
 * Events that have not ended, starting before the end of tomorrow: what
 * GNOME Shell's event source gives the extension.
 */
export function upcoming<T extends CalendarEvent>(events: readonly T[], nowMs: number): T[] {
    const end = new Date(nowMs).setHours(0, 0, 0, 0) + 2 * DAY_MS;
    return events.filter((event) => event.endMs > nowMs && event.startMs < end);
}

/** The feed an event came from: its id is `"<feed>\n<uid>\n<start>"`. */
export function feedOf(id: string): number {
    const feed = Number(id.slice(0, id.indexOf('\n')));
    return Number.isInteger(feed) ? feed : -1;
}

/** Where a feed's calendar opens on the web, by its host; null for one Nokta does not know. */
export function webCalendar(feed: string): string | null {
    let host: string;
    try {
        host = new URL(feed.trim().replace(/^webcal:/i, 'https:')).hostname.toLowerCase();
    } catch {
        return null;
    }
    const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (host === 'calendar.google.com' || host === 'www.google.com') return 'https://calendar.google.com/';
    if (host === 'outlook.live.com') return 'https://outlook.live.com/calendar/';
    if (under('office365.com') || under('office.com') || under('outlook.com')) return 'https://outlook.office.com/calendar/';
    if (under('icloud.com')) return 'https://www.icloud.com/calendar/';
    return null;
}

/** Calendar1, only on Windows: the events of the calendar feeds, which the core reads. */
export class Calendar extends Follower {
    events: FeedEvent[] = [];

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Calendar1', onChanged);
    }

    get(id: string): FeedEvent | null {
        return this.events.find((event) => event.id === id) ?? null;
    }

    protected override read(): void {
        this.events = feedEventsFrom(this.props.Events);
    }
}

/**
 * One exact timeout for the next reminder or start, as the extension's
 * CalendarAlarms. `reschedule()` sets it again; call it when the events or
 * the reminder setting change. Nothing polls.
 */
export class CalendarAlarms {
    private timer = 0;
    /** The last alarm that fired, so a timeout that wakes a little early never repeats it. */
    private firedAtMs = 0;

    constructor(
        private readonly events: (nowMs: number) => readonly CalendarEvent[],
        private readonly reminderMinutes: () => number | null,
        private readonly onAlarm: (alarm: Alarm, nowMs: number) => void,
    ) {}

    reschedule(): void {
        this.stop();
        const minutes = this.reminderMinutes();
        if (minutes === null) return;
        const nowMs = Math.max(Date.now(), this.firedAtMs);
        const alarm = nextAlarm(this.events(nowMs), nowMs, minutes);
        if (!alarm) return;
        const delay = Math.max(0, Math.min(alarm.atMs - Date.now(), 2 ** 31 - 1));
        this.timer = window.setTimeout(() => {
            this.timer = 0;
            this.firedAtMs = alarm.atMs;
            this.onAlarm(alarm, Date.now());
            this.reschedule();
        }, delay);
    }

    stop(): void {
        window.clearTimeout(this.timer);
        this.timer = 0;
    }
}
