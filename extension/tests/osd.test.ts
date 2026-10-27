import assert from 'node:assert/strict';
import { test } from 'node:test';

import { capsLockContent, osdContent } from '../src/features/osd/logic/content.js';
import { routeOsd } from '../src/features/osd/logic/route.js';
import { OsdTimer } from '../src/features/osd/logic/timer.js';

test('level_shows_bar_and_percent', () => {
    assert.deepEqual(osdContent(0.5, 1, null), { fraction: 0.5, text: '50%' });
    assert.deepEqual(osdContent(0.333, undefined, null), { fraction: 0.333, text: '33%' });
});

test('level_wins_over_label', () => {
    assert.deepEqual(osdContent(0.2, 1, 'Built-in display'), { fraction: 0.2, text: '20%' });
});

test('level_above_one_fills_against_max_level', () => {
    const content = osdContent(1.2, 1.5, null);
    assert.equal(content.text, '120%');
    assert.ok(Math.abs((content.fraction ?? -1) - 0.8) < 1e-9);
});

test('fraction_is_clamped', () => {
    assert.deepEqual(osdContent(1.4, 1, null), { fraction: 1, text: '140%' });
    assert.deepEqual(osdContent(-0.1, 1, null), { fraction: 0, text: '0%' });
});

test('bad_max_level_counts_as_one', () => {
    assert.deepEqual(osdContent(0.4, 0, null), { fraction: 0.4, text: '40%' });
    assert.deepEqual(osdContent(0.4, Number.NaN, null), { fraction: 0.4, text: '40%' });
});

test('label_only_hides_bar', () => {
    assert.deepEqual(osdContent(null, null, 'Airplane mode on'), { fraction: null, text: 'Airplane mode on' });
    assert.deepEqual(osdContent(Number.NaN, 1, 'Mic muted'), { fraction: null, text: 'Mic muted' });
});

test('nothing_shows_icon_only', () => {
    assert.deepEqual(osdContent(null, null, null), { fraction: null, text: '' });
    assert.deepEqual(osdContent(undefined, undefined, ''), { fraction: null, text: '' });
});

test('caps_lock_text', () => {
    assert.deepEqual(capsLockContent(true), { fraction: null, text: 'Caps Lock on' });
    assert.deepEqual(capsLockContent(false), { fraction: null, text: 'Caps Lock off' });
});

/** A fake clock: schedule() queues timers, advance() runs the due ones. */
function setup(durationMs = 1500) {
    let now = 0;
    const timers = new Set<{ at: number; fn: () => void }>();
    const changes: boolean[] = [];
    const timer = new OsdTimer(
        (ms, fn) => {
            const t = { at: now + ms, fn };
            timers.add(t);
            return () => timers.delete(t);
        },
        () => durationMs,
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

test('show_then_hide_after_duration', () => {
    const { timer, advance, changes } = setup();
    timer.show();
    assert.equal(timer.active, true);
    advance(1499);
    assert.equal(timer.active, true);
    advance(1);
    assert.equal(timer.active, false);
    assert.deepEqual(changes, [true, false]);
});

test('second_show_restarts_without_new_change', () => {
    const { timer, advance, changes, pending } = setup();
    timer.show();
    advance(1000);
    timer.show();
    assert.equal(pending(), 1);
    advance(1000);
    assert.equal(timer.active, true);
    advance(500);
    assert.equal(timer.active, false);
    assert.deepEqual(changes, [true, false]);
});

test('hide_cancels_at_once', () => {
    const { timer, changes, pending } = setup();
    timer.show();
    timer.hide();
    assert.equal(timer.active, false);
    assert.equal(pending(), 0);
    timer.hide();
    assert.deepEqual(changes, [true, false]);
});

test('destroy_cancels_without_change', () => {
    const { timer, changes, pending } = setup();
    timer.show();
    timer.destroy();
    assert.equal(pending(), 0);
    assert.deepEqual(changes, [true]);
});

test('route_explicit_monitor_with_notch', () => {
    assert.deepEqual(routeOsd({ requested: 1, focused: 0, primary: 0, notches: [0, 1] }), { monitor: 1, notch: 1 });
});

test('route_no_monitor_goes_to_focused', () => {
    assert.deepEqual(routeOsd({ requested: -1, focused: 1, primary: 0, notches: [0, 1] }), { monitor: 1, notch: 1 });
});

test('route_focused_without_notch_draws_on_primary', () => {
    assert.deepEqual(routeOsd({ requested: -1, focused: 1, primary: 0, notches: [0] }), { monitor: 1, notch: 0 });
});

test('route_explicit_without_notch_keeps_monitor_for_gnome', () => {
    assert.deepEqual(routeOsd({ requested: 2, focused: 0, primary: 0, notches: [0] }), { monitor: 2, notch: 0 });
});

test('route_invalid_focus_uses_primary', () => {
    assert.deepEqual(routeOsd({ requested: -1, focused: -1, primary: 1, notches: [0, 1] }), { monitor: 1, notch: 1 });
});

test('route_without_notches_draws_nothing', () => {
    assert.deepEqual(routeOsd({ requested: -1, focused: 0, primary: 0, notches: [] }), { monitor: 0, notch: null });
});
