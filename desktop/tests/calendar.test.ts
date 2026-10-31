import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { feedEventsFrom, feedOf, upcoming, webCalendar } from '../src/calendar.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';
import { homeRows } from '../src/views/home.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

const MINUTE = 60_000;
const GOOGLE = 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics';
const MEET = 'https://meet.google.com/abc-defg-hij';

/** 2 November 2026, 08:45 on the test's clock. */
const NOW = new Date(2026, 10, 2, 8, 45).getTime();

/** One `Calendar1.Events` entry, from feed 0, starting `inMinutes` after NOW. */
const event = (uid: string, title: string, inMinutes: number, { minutes = 30, link = '', color = '' } = {}): Props => {
    const start = NOW + inMinutes * MINUTE;
    return { id: `0\n${uid}\n${start}`, title, start, end: start + minutes * MINUTE, link, color };
};

const mounted: MonitorNotch[] = [];

async function mount(events: Props[], calendar: Props = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const bridge = new MockBridge({
        Settings1: {
            Behavior: { alert_duration_ms: 5000 },
            Appearance: { alert_motion: false },
            Calendar: { feeds: [GOOGLE], ...calendar },
        },
        Calendar1: { Events: events },
    });
    const root = document.createElement('div');
    document.body.append(root);
    const openUri = vi.fn();
    const notch = new MonitorNotch(
        bridge,
        { systemUses24h: () => true, setHit: () => {}, onPointer: () => {}, openUri },
        root,
        STILL,
    );
    mounted.push(notch);
    await notch.start(600);
    const visible = (selector: string) =>
        [...root.querySelectorAll<HTMLElement>(selector)].filter((e) => !e.closest('[hidden]'));
    const texts = (selector: string) => visible(selector).map((e) => e.textContent);
    const shown = (view: string) => root.querySelector(`.nokta-${view}`)?.classList.contains('nokta-shown') ?? false;
    return { bridge, notch, root, openUri, visible, texts, shown };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
    vi.useRealTimers();
});

describe('Calendar1 over the bridge', () => {
    it("reads the core's events, and nothing else", () => {
        expect(
            feedEventsFrom([
                { id: '0\na\n1', title: ' Standup ', start: 1, end: 2, link: MEET, color: '#1BADF8' },
                { id: '0\nb\n1', title: '', start: 1, end: 2, link: 'javascript:alert(1)', color: 'red' },
                { id: 7, title: 'x', start: 1, end: 2 },
                { id: '0\nc\n1', title: 'x', start: '1', end: 2 },
            ]),
        ).toEqual([
            { id: '0\na\n1', title: 'Standup', startMs: 1, endMs: 2, link: MEET, color: '#1BADF8' },
            { id: '0\nb\n1', title: 'Untitled event', startMs: 1, endMs: 2, link: '', color: null },
        ]);
        expect(feedEventsFrom(null)).toEqual([]);
    });

    it('keeps the events not ended that start by the end of tomorrow, as GNOME gives them', () => {
        const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
        const events = [
            { id: 'ended', title: '', startMs: at(2, 6), endMs: at(2, 7) },
            { id: 'running', title: '', startMs: at(2, 8), endMs: at(2, 10) },
            { id: 'tomorrow', title: '', startMs: at(3, 23), endMs: at(4, 0) },
            { id: 'later', title: '', startMs: at(4, 0), endMs: at(4, 1) },
        ];
        expect(upcoming(events, NOW).map((e) => e.id)).toEqual(['running', 'tomorrow']);
    });

    it('opens a feed in its calendar on the web, by its host', () => {
        expect(feedOf('2\nuid\n123')).toBe(2);
        expect(feedOf('nonsense')).toBe(-1);
        expect(webCalendar(GOOGLE)).toBe('https://calendar.google.com/');
        expect(webCalendar('https://outlook.office365.com/owa/calendar/x/reachcalendar.ics')).toBe(
            'https://outlook.office.com/calendar/',
        );
        expect(webCalendar('https://outlook.live.com/owa/calendar/x/calendar.ics')).toBe('https://outlook.live.com/calendar/');
        expect(webCalendar('webcal://p01-caldav.icloud.com/published/2/x')).toBe('https://www.icloud.com/calendar/');
        expect(webCalendar('https://example.com/a.ics')).toBeNull();
        expect(webCalendar('not a url')).toBeNull();
    });
});

describe('the calendar on Windows', () => {
    it("lists home's agenda: time, title, how soon, the calendar's color and Join for a meeting", async () => {
        const { notch, texts, visible } = await mount([
            event('a', 'Standup', 15, { link: MEET, color: '#1badf8' }),
            event('b', 'Review', 75),
            event('c', 'Lunch', 195),
        ]);
        notch.open(true);
        expect(texts('.nokta-panel-event-time')).toEqual(['09:00', '10:00', '12:00']);
        expect(texts('.nokta-panel-event-title')).toEqual(['Standup', 'Review', 'Lunch']);
        expect(texts('.nokta-panel-event-when')).toEqual(['in 15 min']);
        expect(visible('.nokta-panel-join')).toHaveLength(1);
        expect(visible('.nokta-panel-event-strip')[0]!.style.backgroundColor).toBe('#1badf8');
    });

    it('shows at most agenda_size events, none with the calendar off, and counts them in home', async () => {
        const events = [event('a', 'Standup', 15), event('b', 'Review', 75), event('c', 'Lunch', 195)];
        const { notch, bridge, texts } = await mount(events, { agenda_size: 2 });
        notch.open(true);
        expect(texts('.nokta-panel-event-title')).toEqual(['Standup', 'Review']);
        bridge.set('Settings1', { Calendar: { feeds: [GOOGLE], enabled: false } });
        expect(texts('.nokta-panel-event-title')).toEqual([]);
        const layout = { toggles: [], tiles: [] };
        expect(homeRows(layout, { events: 7 })).toEqual(['date', 'event', 'agenda', 'agenda', 'agenda', 'agenda']);
    });

    it('opens the calendar from a row and the meeting from Join, and Join ends the countdown', async () => {
        const { notch, root, openUri, visible } = await mount([event('a', 'Standup', 3, { link: MEET })]);
        expect(visible('.nokta-countdown-label').map((e) => e.textContent)).toContain('3 min');
        notch.open(true);
        root.querySelector<HTMLElement>('.nokta-panel-event-main')!.click();
        expect(openUri).toHaveBeenLastCalledWith('https://calendar.google.com/');
        notch.open(true);
        root.querySelector<HTMLElement>('.nokta-panel-join')!.click();
        expect(openUri).toHaveBeenLastCalledWith(MEET);
        expect(visible('.nokta-countdown-label')).toEqual([]);
    });

    it('reminds of a meeting like a notification with Join, and of another event with an alert', async () => {
        const { shown, texts, openUri, root } = await mount(
            [event('a', 'Standup', 15, { link: MEET }), event('b', 'Dentist', 45)],
            { reminder_minutes: 10 },
        );
        vi.advanceTimersByTime(5 * MINUTE);
        expect(shown('notification')).toBe(true);
        expect(texts('.nokta-notification-title')).toEqual(['Standup in 10 min']);
        expect(texts('.nokta-notification-button')).toEqual(['Join']);
        root.querySelector<HTMLElement>('.nokta-notification-button')!.click();
        expect(openUri).toHaveBeenLastCalledWith(MEET);
        expect(shown('notification')).toBe(false);

        // Dentist at 09:30: its reminder at 09:20.
        vi.advanceTimersByTime(30 * MINUTE);
        expect(shown('osd')).toBe(true);
        expect(texts('.nokta-osd-text')).toEqual(['Dentist in 10 min']);
    });

    it('counts down to the next meeting on the closed notch from its reminder, then says Now', async () => {
        const { texts } = await mount([event('a', 'Standup', 12)], { reminder_minutes: 10 });
        expect(texts('.nokta-countdown-label')).toEqual([]);
        vi.advanceTimersByTime(2 * MINUTE);
        expect(texts('.nokta-countdown-label')).toContain('10 min');
        vi.advanceTimersByTime(10 * MINUTE);
        expect(texts('.nokta-countdown-label')).toContain('Now');
        vi.advanceTimersByTime(5 * MINUTE);
        expect(texts('.nokta-countdown-label')).toEqual([]);
    });
});
