import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    CRITICAL,
    notificationLines,
    plainText,
    takesBanner,
} from '../src/features/notifications/logic/content.js';
import { LEAVE_MS, NotificationTimer } from '../src/features/notifications/logic/timer.js';

test('the notch takes the banners GNOME would show', () => {
    const shown = { inNotch: true, urgency: 1, notchShown: true };
    assert.equal(takesBanner(shown), true);
    assert.equal(takesBanner({ ...shown, urgency: 2 }), true);
    // Critical ones stay in GNOME's banner, which keeps them until dismissed.
    assert.equal(takesBanner({ ...shown, urgency: CRITICAL }), false);
    assert.equal(takesBanner({ ...shown, inNotch: false }), false);
    // A fullscreen app hides the notch.
    assert.equal(takesBanner({ ...shown, notchShown: false }), false);
});

test('markup becomes one line of plain text', () => {
    assert.equal(plainText('<b>Rama</b>: see you at <i>7</i>'), 'Rama: see you at 7');
    assert.equal(plainText('Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; &#x41;'), 'Tom & Jerry <3 "hi" \'x\' A');
    assert.equal(plainText('first line\n\n  second\tline  '), 'first line second line');
    assert.equal(plainText('<a href="https://x.io">link</a>'), 'link');
    assert.equal(plainText(''), '');
});

test('the title, then the body or the app', () => {
    const n = { title: 'Rama', body: 'Lunch <b>now</b>?', app: 'Telegram' };
    assert.deepEqual(notificationLines(n, true), { title: 'Rama', detail: 'Lunch now?' });
    // show_body off keeps the message private: only who sent it and where.
    assert.deepEqual(notificationLines(n, false), { title: 'Rama', detail: 'Telegram' });
    assert.deepEqual(notificationLines({ ...n, body: '  ' }, true), { title: 'Rama', detail: 'Telegram' });
    assert.deepEqual(notificationLines({ title: '', body: 'Done', app: 'Files' }, true), {
        title: 'Files',
        detail: 'Done',
    });
    assert.deepEqual(notificationLines({ title: 'Saved', body: '', app: '' }, true), { title: 'Saved', detail: '' });
});

function setup() {
    let now = 0;
    const timers = new Set<{ at: number; fn: () => void }>();
    const changes: boolean[] = [];
    const timer = new NotificationTimer(
        (ms, fn) => {
            const t = { at: now + ms, fn };
            timers.add(t);
            return () => timers.delete(t);
        },
        (active) => changes.push(active),
    );
    const advance = (ms: number) => {
        now += ms;
        for (const t of [...timers].sort((a, b) => a.at - b.at)) {
            if (t.at <= now && timers.delete(t)) t.fn();
        }
    };
    return { timer, advance, changes, pending: () => timers.size };
}

test('a notification hides after its duration', () => {
    const { timer, advance, changes } = setup();
    timer.show(5000);
    assert.equal(timer.active, true);
    advance(4999);
    assert.equal(timer.active, true);
    advance(1);
    assert.deepEqual(changes, [true, false]);
});

test('a new notification restarts the time without a second change', () => {
    const { timer, advance, changes } = setup();
    timer.show(5000);
    advance(4000);
    timer.show(5000);
    advance(4000);
    assert.equal(timer.active, true);
    advance(1000);
    assert.deepEqual(changes, [true, false]);
});

test('the pointer keeps it open, and it hides a moment after leaving', () => {
    const { timer, advance, changes, pending } = setup();
    timer.show(5000);
    timer.pointer(true);
    assert.equal(pending(), 0);
    advance(60_000);
    assert.equal(timer.active, true);
    timer.pointer(false);
    advance(LEAVE_MS - 1);
    assert.equal(timer.active, true);
    advance(1);
    assert.deepEqual(changes, [true, false]);
});

test('the pointer does nothing while no notification shows', () => {
    const { timer, changes, pending } = setup();
    timer.pointer(true);
    timer.pointer(false);
    assert.equal(pending(), 0);
    assert.deepEqual(changes, []);
});

test('hide ends it at once and clears the timer', () => {
    const { timer, changes, pending } = setup();
    timer.show(5000);
    timer.pointer(true);
    timer.hide();
    assert.equal(timer.active, false);
    assert.equal(pending(), 0);
    timer.hide();
    assert.deepEqual(changes, [true, false]);
});
