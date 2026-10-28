import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    alarmAlert,
    eventAlert,
    eventsFrom,
    eventTime,
    nextAlarm,
    nextEvent,
    soonLabel,
    type CalendarEvent,
} from '../src/features/calendar/logic/events.js';

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

test('the time says tomorrow for an event after today; the source holds no later ones', () => {
    assert.equal(eventTime(at(10, 30), at(8), hhmm), '10:30');
    assert.equal(eventTime(at(9, 0, 29), at(20), hhmm), 'Tomorrow 09:00');
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
