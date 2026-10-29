import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    agendaEvents,
    agendaWhen,
    alarmAlert,
    countdownEvent,
    countdownLabel,
    countdownWindow,
    countdownChangeMs,
    eventColor,
    eventAlert,
    eventsFrom,
    nextAlarm,
    nextEvent,
    soonLabel,
    type CalendarEvent,
} from '../src/features/calendar/logic/events.js';
import { idsToAsk } from '../src/features/calendar/logic/answers.js';

/** Local time today (28 October 2026) or on a later day. */
const at = (hour: number, minute = 0, day = 28): number => new Date(2026, 9, day, hour, minute).getTime();
const event = (title: string, start: number, end: number, id = title): CalendarEvent => ({
    id,
    title,
    startMs: start,
    endMs: end,
});
const hhmm = (ms: number): string => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

test('events come from the shell event source, without all-day ones', () => {
    const shell = [
        { id: 'a', date: new Date(at(10, 30)), end: new Date(at(11)), summary: 'Standup' },
        { id: 'b', date: new Date(at(0)), end: new Date(at(0, 0, 29)), summary: 'Holiday' },
        { id: 'c', date: new Date(at(0)), end: new Date(at(0, 0, 31)), summary: 'Trip' },
        { id: 'd', date: new Date(at(0)), end: new Date(at(1)), summary: 'Midnight call' },
        { id: 'e', date: 'nope', end: new Date(at(1)), summary: 'Broken' },
    ];
    assert.deepEqual(eventsFrom(shell), [
        event('Standup', at(10, 30), at(11), 'a'),
        event('Midnight call', at(0), at(1), 'd'),
    ]);
    assert.deepEqual(eventsFrom(undefined), []);
    assert.equal(eventsFrom([{ id: 'x', date: new Date(at(9)), end: new Date(at(10)), summary: '' }])[0].title, 'Untitled event');
});

test('the next event is the first one that has not ended', () => {
    const events = [
        event('Lunch', at(12), at(13)),
        event('Standup', at(9), at(9, 15)),
        event('Review', at(10), at(11)),
    ];
    assert.equal(nextEvent(events, at(8))?.title, 'Standup');
    assert.equal(nextEvent(events, at(9, 10))?.title, 'Standup', 'a running event still counts');
    assert.equal(nextEvent(events, at(9, 15))?.title, 'Review');
    assert.equal(nextEvent(events, at(13)), null);
    assert.equal(nextEvent([], at(8)), null);
});

test('an agenda row has its time apart; the first says how soon, a later day says tomorrow', () => {
    assert.deepEqual(agendaWhen(at(10, 25), at(10), true, hhmm), { time: '10:25', detail: 'in 25 min' });
    assert.deepEqual(agendaWhen(at(11), at(10), false, hhmm), { time: '11:00', detail: '' });
    assert.deepEqual(agendaWhen(at(9, 0, 29), at(10), false, hhmm), { time: '09:00', detail: 'Tomorrow' });
    assert.deepEqual(agendaWhen(at(9, 0, 29), at(20), true, hhmm), { time: '09:00', detail: 'Tomorrow · in 13 h' });
});

test('an event color is used only as six hex digits', () => {
    assert.equal(eventColor('#62a0ea'), '#62a0ea');
    assert.equal(eventColor('#62A0EA'), '#62A0EA');
    assert.equal(eventColor('#fa0'), null);
    assert.equal(eventColor('red; background: url(x)'), null);
    assert.equal(eventColor(''), null);
    assert.equal(eventColor(null), null);
});

test('soon counts minutes up, then hours', () => {
    assert.equal(soonLabel(at(10, 25), at(10)), 'in 25 min');
    assert.equal(soonLabel(at(10) + 30_000, at(10)), 'in 1 min');
    assert.equal(soonLabel(at(10), at(10)), 'now');
    assert.equal(soonLabel(at(9), at(10)), 'now');
    assert.equal(soonLabel(at(11), at(10)), 'in 1 h');
    assert.equal(soonLabel(at(12, 5), at(10)), 'in 2 h 5 min');
});

test('the next alarm is the reminder, then the start', () => {
    const events = [event('Standup', at(10), at(10, 15)), event('Review', at(10, 3), at(11))];
    assert.deepEqual(nextAlarm(events, at(9), 5), { atMs: at(9, 55), kind: 'reminder', event: events[0] });
    assert.deepEqual(nextAlarm(events, at(9, 55), 5), { atMs: at(9, 58), kind: 'reminder', event: events[1] });
    assert.deepEqual(nextAlarm(events, at(9, 58), 5), { atMs: at(10), kind: 'start', event: events[0] });
    assert.deepEqual(nextAlarm(events, at(10), 5), { atMs: at(10, 3), kind: 'start', event: events[1] });
    assert.equal(nextAlarm(events, at(10, 3), 5), null);
    // No reminder: only the starts.
    assert.deepEqual(nextAlarm(events, at(9), 0), { atMs: at(10), kind: 'start', event: events[0] });
    // A reminder already past when the event appears: straight to the start.
    assert.deepEqual(nextAlarm([events[0]], at(9, 57), 5), { atMs: at(10), kind: 'start', event: events[0] });
});

test('alerts say how soon, or that it is starting', () => {
    const standup = event('Standup', at(10), at(10, 15));
    assert.deepEqual(eventAlert(standup, 'reminder', at(9, 55), hhmm), {
        icon: 'x-office-calendar-symbolic',
        title: 'Standup in 5 min',
        detail: '10:00',
        urgent: false,
    });
    assert.deepEqual(eventAlert(standup, 'start', at(10), hhmm), {
        icon: 'x-office-calendar-symbolic',
        title: 'Standup is starting',
        detail: '10:00 – 10:15',
        urgent: false,
    });
});

test('a late alarm says what is true when it fires', () => {
    const standup = event('Standup', at(10), at(10, 15));
    const reminder = { atMs: at(9, 55), kind: 'reminder' as const, event: standup };
    assert.equal(alarmAlert(reminder, at(9, 55), hhmm)?.title, 'Standup in 5 min');
    // Woken after a suspend: the event started, or ended.
    assert.equal(alarmAlert(reminder, at(10, 2), hhmm)?.title, 'Standup is starting');
    assert.equal(alarmAlert(reminder, at(10, 15), hhmm), null);
    assert.equal(alarmAlert({ ...reminder, kind: 'start', atMs: at(10) }, at(10), hhmm)?.title, 'Standup is starting');
});

test('the agenda lists events that have not ended, soonest first, up to its size', () => {
    const now = at(10);
    const events = [
        event('Tomorrow', at(9, 0, 29), at(10, 0, 29)),
        event('Lunch', at(12), at(13)),
        event('Done', at(8), at(9)),
        event('Running', at(9, 30), at(10, 30)),
        event('Review', at(15), at(16)),
    ];
    assert.deepEqual(
        agendaEvents(events, now, 3).map((e) => e.title),
        ['Running', 'Lunch', 'Review'],
    );
    // Tomorrow fills in when today has fewer.
    assert.deepEqual(
        agendaEvents(events, now, 5).map((e) => e.title),
        ['Running', 'Lunch', 'Review', 'Tomorrow'],
    );
    assert.deepEqual(agendaEvents(events, now, 1).map((e) => e.title), ['Running']);
    assert.deepEqual(agendaEvents([], now, 3), []);
});

test('the countdown says the minutes left, then Now', () => {
    const start = at(10);
    assert.equal(countdownLabel(start, start - 5 * 60_000), '5 min');
    assert.equal(countdownLabel(start, start - 4.5 * 60_000), '5 min');
    assert.equal(countdownLabel(start, start - 30_000), '1 min');
    assert.equal(countdownLabel(start, start), 'Now');
    assert.equal(countdownLabel(start, start + 3 * 60_000), 'Now');
});

test('the countdown runs from the reminder until 5 minutes after the start', () => {
    const standup = event('Standup', at(10), at(10, 30));
    assert.equal(countdownWindow(standup, at(9, 54), 5), false);
    assert.equal(countdownWindow(standup, at(9, 55), 5), true);
    assert.equal(countdownWindow(standup, at(10, 4), 5), true);
    assert.equal(countdownWindow(standup, at(10, 5), 5), false);
    // Without a reminder there is no countdown.
    assert.equal(countdownWindow(standup, at(9, 59), 0), false);
    // A short event ends its countdown when it ends.
    const short = event('Ping', at(10), at(10, 2));
    assert.equal(countdownWindow(short, at(10, 3), 5), false);
});

test('the countdown shows the soonest event in its window, except dismissed ones', () => {
    const a = event('A', at(10), at(11));
    const b = event('B', at(10, 2), at(11));
    assert.equal(countdownEvent([b, a], at(9, 58), 5, new Set())?.title, 'A');
    assert.equal(countdownEvent([b, a], at(9, 58), 5, new Set(['A']))?.title, 'B');
    assert.equal(countdownEvent([b, a], at(9, 50), 5, new Set()), null);
});

test('the countdown redraws when its minute changes, then when it ends', () => {
    const standup = event('Standup', at(10), at(10, 30));
    assert.equal(countdownChangeMs(standup, at(9, 55)), 60_000);
    assert.equal(countdownChangeMs(standup, at(9, 55) + 20_000), 40_000);
    assert.equal(countdownChangeMs(standup, at(9, 59) + 30_000), 30_000);
    // Now holds until 5 minutes after the start, or the end if sooner.
    assert.equal(countdownChangeMs(standup, at(10, 1)), 4 * 60_000);
    assert.equal(countdownChangeMs(event('Ping', at(10), at(10, 2)), at(10)), 2 * 60_000);
});

test('answers are asked for new events, and again after 10 minutes', () => {
    const asked = new Map([
        ['old', at(9)],
        ['recent', at(9, 55)],
    ]);
    assert.deepEqual(idsToAsk(['new', 'old', 'recent', 'new'], asked, at(10)), ['new', 'old']);
    assert.deepEqual(idsToAsk([], asked, at(10)), []);
});
