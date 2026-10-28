import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NotchMachine, type NotchMode, type OpenOn } from '../src/shared/logic/machine.js';

/** A fake clock: schedule() queues timers, advance() runs the due ones. */
function setup(openMs = 120, closeMs = 300, openOn: OpenOn = 'hover') {
    let now = 0;
    const timers = new Set<{ at: number; fn: () => void }>();
    const changes: Array<[NotchMode, NotchMode]> = [];
    const machine = new NotchMachine(
        (ms, fn) => {
            const timer = { at: now + ms, fn };
            timers.add(timer);
            return () => timers.delete(timer);
        },
        () => ({ openMs, closeMs, openOn }),
        (mode, previous) => changes.push([previous, mode]),
    );
    const advance = (ms: number) => {
        now += ms;
        for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
            if (timer.at <= now && timers.delete(timer)) timer.fn();
        }
    };
    return { machine, advance, changes, pending: () => timers.size };
}

test('available_moves_idle_to_collapsed_and_back', () => {
    const { machine, changes } = setup();
    machine.setAvailable(true);
    assert.equal(machine.mode, 'collapsed');
    machine.setAvailable(false);
    assert.equal(machine.mode, 'idle');
    assert.deepEqual(changes, [['idle', 'collapsed'], ['collapsed', 'idle']]);
});

test('hover_opens_after_open_delay', () => {
    const { machine, advance } = setup();
    machine.setAvailable(true);
    machine.pointer(true);
    advance(119);
    assert.equal(machine.mode, 'collapsed');
    advance(1);
    assert.equal(machine.mode, 'expanded');
});

test('leave_closes_after_close_delay_and_reenter_cancels', () => {
    const { machine, advance } = setup();
    machine.setAvailable(true);
    machine.pointer(true);
    advance(120);
    machine.pointer(false);
    advance(200);
    machine.pointer(true);
    advance(1000);
    assert.equal(machine.mode, 'expanded');
    machine.pointer(false);
    advance(300);
    assert.equal(machine.mode, 'collapsed');
});

test('leaving_before_open_delay_never_opens', () => {
    const { machine, advance, pending } = setup();
    machine.setAvailable(true);
    machine.pointer(true);
    advance(60);
    machine.pointer(false);
    advance(1000);
    assert.equal(machine.mode, 'collapsed');
    assert.equal(pending(), 0);
});

test('hover_while_idle_opens_the_panel_and_leaving_closes_it', () => {
    const { machine, advance, changes } = setup();
    machine.pointer(true);
    advance(119);
    assert.equal(machine.mode, 'idle');
    advance(1);
    assert.equal(machine.mode, 'expanded');
    machine.pointer(false);
    advance(300);
    assert.equal(machine.mode, 'idle');
    assert.deepEqual(changes, [['idle', 'expanded'], ['expanded', 'idle']]);
});

test('player_gone_after_leaving_goes_idle_and_cancels_timers', () => {
    const { machine, advance, pending } = setup();
    machine.setAvailable(true);
    machine.pointer(true);
    advance(120);
    machine.pointer(false);
    machine.setAvailable(false);
    assert.equal(machine.mode, 'idle');
    assert.equal(pending(), 0);
});

test('a_player_coming_or_going_under_the_pointer_keeps_it_open', () => {
    const { machine, advance } = setup();
    machine.setAvailable(true);
    machine.pointer(true);
    advance(120);
    machine.setAvailable(false);
    assert.equal(machine.mode, 'expanded');
    machine.setAvailable(true);
    assert.equal(machine.mode, 'expanded');
    machine.setAvailable(false);
    machine.pointer(false);
    advance(300);
    assert.equal(machine.mode, 'idle');
});

test('becoming_available_under_the_pointer_starts_the_open_delay', () => {
    const { machine, advance } = setup();
    machine.pointer(true);
    machine.setAvailable(true);
    advance(120);
    assert.equal(machine.mode, 'expanded');
});

test('destroy_cancels_pending_timers', () => {
    const { machine, pending } = setup();
    machine.setAvailable(true);
    machine.pointer(true);
    machine.destroy();
    assert.equal(pending(), 0);
});

test('close_shuts_the_open_notch_until_the_pointer_comes_back', () => {
    const { machine, advance, pending } = setup();
    machine.pointer(true);
    advance(120);
    machine.close();
    assert.equal(machine.mode, 'idle');
    assert.equal(pending(), 0);
    advance(1000);
    assert.equal(machine.mode, 'idle');
    machine.pointer(false);
    machine.pointer(true);
    advance(120);
    assert.equal(machine.mode, 'expanded');
});

test('with_click_resting_the_pointer_never_opens', () => {
    const { machine, advance, pending } = setup(120, 300, 'click');
    machine.setAvailable(true);
    machine.pointer(true);
    advance(1000);
    assert.equal(machine.mode, 'collapsed');
    assert.equal(pending(), 0);
});

test('with_click_a_click_opens_at_once_and_leaving_closes_after_the_delay', () => {
    const { machine, advance } = setup(120, 300, 'click');
    machine.setAvailable(true);
    machine.pointer(true);
    assert.equal(machine.click(), true);
    assert.equal(machine.mode, 'expanded');
    // A click on the open notch is its views' own.
    assert.equal(machine.click(), false);
    machine.pointer(false);
    advance(299);
    assert.equal(machine.mode, 'expanded');
    machine.pointer(true);
    advance(1000);
    assert.equal(machine.mode, 'expanded');
    machine.pointer(false);
    advance(300);
    assert.equal(machine.mode, 'collapsed');
    // Back on it, it waits for the next click.
    machine.pointer(true);
    advance(1000);
    assert.equal(machine.mode, 'collapsed');
});

test('with_hover_a_click_leaves_opening_to_the_delay', () => {
    const { machine, advance } = setup();
    machine.pointer(true);
    assert.equal(machine.click(), false);
    assert.equal(machine.mode, 'idle');
    advance(120);
    assert.equal(machine.mode, 'expanded');
});

test('open_opens_at_once_and_cancels_a_pending_open', () => {
    const { machine, advance, pending, changes } = setup();
    machine.setAvailable(true);
    machine.pointer(true);
    advance(60);
    machine.open();
    assert.equal(machine.mode, 'expanded');
    assert.equal(pending(), 0);
    advance(1000);
    assert.deepEqual(changes, [['idle', 'collapsed'], ['collapsed', 'expanded']]);
});

test('held_open_the_pointer_leaving_does_not_close_it', () => {
    const { machine, advance, pending } = setup();
    machine.setAvailable(true);
    machine.open(true);
    assert.equal(machine.held, true);
    machine.pointer(true);
    machine.pointer(false);
    advance(1000);
    assert.equal(machine.mode, 'expanded');
    assert.equal(pending(), 0);
    // Nor does the player going.
    machine.setAvailable(false);
    assert.equal(machine.mode, 'expanded');
});

test('closing_lets_go_of_the_hold', () => {
    const { machine, advance } = setup();
    machine.open(true);
    machine.close();
    assert.equal(machine.mode, 'idle');
    assert.equal(machine.held, false);
    machine.pointer(true);
    advance(120);
    machine.pointer(false);
    advance(300);
    assert.equal(machine.mode, 'idle');
});

test('opening_held_over_the_hover_open_notch_holds_it', () => {
    const { machine, advance } = setup();
    machine.pointer(true);
    advance(120);
    machine.pointer(false);
    machine.open(true);
    advance(1000);
    assert.equal(machine.mode, 'expanded');
    assert.equal(machine.held, true);
});

test('open_without_hold_closes_on_leave_as_hover_would', () => {
    const { machine, advance } = setup();
    machine.pointer(true);
    machine.open();
    assert.equal(machine.held, false);
    machine.pointer(false);
    advance(300);
    assert.equal(machine.mode, 'idle');
});

test('after_close_the_pointer_staying_on_it_does_not_reopen_it', () => {
    const { machine, advance } = setup();
    machine.pointer(true);
    advance(120);
    machine.close();
    // The notch says again where the pointer is, as it does after the keyboard lets go.
    machine.pointer(true);
    advance(1000);
    assert.equal(machine.mode, 'idle');
});
