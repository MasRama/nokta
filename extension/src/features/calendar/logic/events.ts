/** One timed event from GNOME Shell's calendar event source. */
export interface CalendarEvent {
    id: string;
    title: string;
    startMs: number;
    endMs: number;
}

export type AlarmKind = 'reminder' | 'start';

/** The next moment the notch says something about an event. */
export interface Alarm {
    atMs: number;
    kind: AlarmKind;
    event: CalendarEvent;
}

/** What the notch shows for an alarm, like a device alert. */
export interface EventAlert {
    icon: string;
    title: string;
    detail: string;
    urgent: boolean;
}

export const CALENDAR_ICON = 'x-office-calendar-symbolic';
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const startOfDay = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0);
const isMidnight = (ms: number): boolean => startOfDay(ms) === ms;

/** Whole local days from `nowMs`'s day to `ms`'s day. */
const daysFrom = (nowMs: number, ms: number): number => Math.round((startOfDay(ms) - startOfDay(nowMs)) / DAY_MS);

/**
 * The events of `DBusEventSource.getEvents()` (`{id, date, end, summary}`
 * with `Date`s), without all-day ones: they run from one midnight to another.
 */
export function eventsFrom(raw: unknown): CalendarEvent[] {
    if (!Array.isArray(raw)) return [];
    const out: CalendarEvent[] = [];
    for (const item of raw as unknown[]) {
        if (item === null || typeof item !== 'object') continue;
        const { id, date, end, summary } = item as Record<string, unknown>;
        if (!(date instanceof Date) || !(end instanceof Date)) continue;
        const startMs = date.getTime();
        const endMs = end.getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
        if (endMs > startMs && isMidnight(startMs) && isMidnight(endMs)) continue;
        out.push({
            id: String(id ?? ''),
            title: typeof summary === 'string' && summary.trim() ? summary.trim() : 'Untitled event',
            startMs,
            endMs,
        });
    }
    return out;
}

/** The earliest event that has not ended at `nowMs`, running or not. */
export function nextEvent(events: readonly CalendarEvent[], nowMs: number): CalendarEvent | null {
    let next: CalendarEvent | null = null;
    for (const event of events) {
        if (event.endMs <= nowMs) continue;
        if (!next || event.startMs < next.startMs) next = event;
    }
    return next;
}

/** Events that have not ended at `nowMs`, soonest first, at most `size`: today's, then tomorrow's. */
export function agendaEvents(events: readonly CalendarEvent[], nowMs: number, size: number): CalendarEvent[] {
    return events
        .filter((event) => event.endMs > nowMs)
        .sort((a, b) => a.startMs - b.startMs)
        .slice(0, Math.max(0, size));
}

/** How long the countdown keeps saying `Now` after the start. */
const COUNTDOWN_AFTER_MS = 5 * MINUTE_MS;

/** `5 min` to `1 min` before the start, rounded up, then `Now`. */
export function countdownLabel(startMs: number, nowMs: number): string {
    if (nowMs >= startMs) return 'Now';
    return `${Math.ceil((startMs - nowMs) / MINUTE_MS)} min`;
}

/**
 * The closed notch counts down to `event` from its reminder until 5 minutes
 * after it starts, or until it ends if that is sooner; never without a reminder.
 */
export function countdownWindow(event: CalendarEvent, nowMs: number, reminderMinutes: number): boolean {
    if (reminderMinutes <= 0) return false;
    const from = event.startMs - reminderMinutes * MINUTE_MS;
    const until = Math.min(event.startMs + COUNTDOWN_AFTER_MS, event.endMs);
    return nowMs >= from && nowMs < until;
}

/** Milliseconds until the countdown to `event` shows another minute, or `Now` ends. */
export function countdownChangeMs(event: CalendarEvent, nowMs: number): number {
    if (nowMs >= event.startMs) return Math.min(event.startMs + COUNTDOWN_AFTER_MS, event.endMs) - nowMs;
    return ((event.startMs - nowMs - 1) % MINUTE_MS) + 1;
}

/** The soonest event in its countdown window, leaving out the ids in `dismissed`. */
export function countdownEvent(
    events: readonly CalendarEvent[],
    nowMs: number,
    reminderMinutes: number,
    dismissed: ReadonlySet<string>,
): CalendarEvent | null {
    let shown: CalendarEvent | null = null;
    for (const event of events) {
        if (dismissed.has(event.id) || !countdownWindow(event, nowMs, reminderMinutes)) continue;
        if (!shown || event.startMs < shown.startMs) shown = event;
    }
    return shown;
}

/** An agenda row's time column, and what it says dimmed after the title. */
export interface AgendaWhen {
    time: string;
    /** `in 25 min` for the first event, `Tomorrow` for a later day, both, or empty. */
    detail: string;
}

/** When an agenda event starts, in its row; `first` is the soonest one, `formatTime` follows the clock setting. */
export function agendaWhen(
    startMs: number,
    nowMs: number,
    first: boolean,
    formatTime: (ms: number) => string,
): AgendaWhen {
    const parts = [];
    if (daysFrom(nowMs, startMs) >= 1) parts.push('Tomorrow');
    if (first) parts.push(soonLabel(startMs, nowMs));
    return { time: formatTime(startMs), detail: parts.join(' · ') };
}

/** The daemon's color for an event's calendar, when it is `#rrggbb`. */
export function eventColor(color: string | null): string | null {
    return color !== null && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

/** `in 25 min`, `in 2 h 5 min`, or `now` once it has started. */
export function soonLabel(startMs: number, nowMs: number): string {
    if (startMs <= nowMs) return 'now';
    const minutes = Math.ceil((startMs - nowMs) / MINUTE_MS);
    if (minutes < 60) return `in ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
}

/**
 * The first reminder (`reminderMinutes` before a start; 0 for none) or start
 * after `nowMs`, over every event.
 */
export function nextAlarm(events: readonly CalendarEvent[], nowMs: number, reminderMinutes: number): Alarm | null {
    let next: Alarm | null = null;
    const consider = (atMs: number, kind: AlarmKind, event: CalendarEvent): void => {
        if (atMs > nowMs && (!next || atMs < next.atMs)) next = { atMs, kind, event };
    };
    for (const event of events) {
        if (reminderMinutes > 0) consider(event.startMs - reminderMinutes * MINUTE_MS, 'reminder', event);
        consider(event.startMs, 'start', event);
    }
    return next;
}

/** `Standup in 5 min` with its time, or `Standup is starting` with its start and end. */
export function eventAlert(
    event: CalendarEvent,
    kind: AlarmKind,
    nowMs: number,
    formatTime: (ms: number) => string,
): EventAlert {
    const start = formatTime(event.startMs);
    return kind === 'reminder'
        ? { icon: CALENDAR_ICON, title: `${event.title} ${soonLabel(event.startMs, nowMs)}`, detail: start, urgent: false }
        : {
              icon: CALENDAR_ICON,
              title: `${event.title} is starting`,
              detail: `${start} – ${formatTime(event.endMs)}`,
              urgent: false,
          };
}

/**
 * The alert for an alarm that fires at `nowMs`. A timeout can wake late
 * (after a suspend): an event that has started is starting, one that has
 * ended shows nothing.
 */
export function alarmAlert(alarm: Alarm, nowMs: number, formatTime: (ms: number) => string): EventAlert | null {
    const { event } = alarm;
    if (nowMs >= event.endMs) return null;
    const kind: AlarmKind = nowMs >= event.startMs ? 'start' : alarm.kind;
    return eventAlert(event, kind, nowMs, formatTime);
}
