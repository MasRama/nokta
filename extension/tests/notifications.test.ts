import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_BUTTONS, notificationButtons } from '../src/features/notifications/logic/actions.js';
import {
    CRITICAL,
    notificationLines,
    plainText,
    takesBanner,
} from '../src/features/notifications/logic/content.js';
import { stackBadge, stackCount } from '../src/features/notifications/logic/stack.js';
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

test("a notification's actions become up to three buttons", () => {
    const actions = [{ label: 'Reply' }, { label: 'Mark as read' }];
    assert.deepEqual(notificationButtons(actions), [
        { label: 'Reply', index: 0 },
        { label: 'Mark as read', index: 1 },
    ]);
    const many = ['One', 'Two', 'Three', 'Four'].map((label) => ({ label }));
    assert.deepEqual(
        notificationButtons(many).map((b) => b.label),
        ['One', 'Two', 'Three'],
    );
    assert.equal(MAX_BUTTONS, 3);
});

test('only actions with a label get a button, and keep their place', () => {
    const actions = [{ label: '  ' }, {}, { label: 7 }, { label: ' Archive ' }];
    assert.deepEqual(notificationButtons(actions), [{ label: 'Archive', index: 3 }]);
});

test('no buttons without an array of actions', () => {
    assert.deepEqual(notificationButtons(undefined), []);
    assert.deepEqual(notificationButtons(null), []);
    assert.deepEqual(notificationButtons({ length: 1, 0: { label: 'Reply' } }), []);
    assert.deepEqual(notificationButtons([]), []);
    assert.deepEqual(notificationButtons([null, 'Reply']), []);
});

test('a new notification from the same source stacks on the one that shows', () => {
    const chat = {};
    const first = {};
    const second = {};
    const third = {};
    assert.equal(stackCount(null, { source: chat, notification: first }), 1);
    const one = { source: chat, notification: first, count: 1 };
    assert.equal(stackCount(one, { source: chat, notification: second }), 2);
    const two = { source: chat, notification: second, count: 2 };
    assert.equal(stackCount(two, { source: chat, notification: third }), 3);
});

test('the same notification again, updated, keeps its count', () => {
    const chat = {};
    const shown = { source: chat, notification: {}, count: 2 };
    assert.equal(stackCount(shown, { source: chat, notification: shown.notification }), 2);
});

test('another source, or none, starts the count again', () => {
    const shown = { source: {}, notification: {}, count: 4 };
    assert.equal(stackCount(shown, { source: {}, notification: {} }), 1);
    assert.equal(stackCount({ ...shown, source: null }, { source: null, notification: {} }), 1);
});

test('the stacked count reads 2 to 9, then 9+', () => {
    assert.equal(stackBadge(1), null);
    assert.equal(stackBadge(0), null);
    assert.equal(stackBadge(2), '2');
    assert.equal(stackBadge(9), '9');
    assert.equal(stackBadge(10), '9+');
    assert.equal(stackBadge(42), '9+');
});
