import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NotchMachine, type NotchMode } from '../src/shared/logic/machine.js';

/** A fake clock: schedule() queues timers, advance() runs the due ones. */
function setup(openMs = 120, closeMs = 300) {
    let now = 0;
    const timers = new Set<{ at: number; fn: () => void }>();
    const changes: Array<[NotchMode, NotchMode]> = [];
    const machine = new NotchMachine(
        (ms, fn) => {
            const timer = { at: now + ms, fn };
            timers.add(timer);
            return () => timers.delete(timer);
        },
        () => ({ openMs, closeMs }),
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

test('hover_while_idle_does_not_open', () => {
    const { machine, advance, pending } = setup();
    machine.pointer(true);
    advance(1000);
    assert.equal(machine.mode, 'idle');
    assert.equal(pending(), 0);
});

test('player_gone_while_expanded_goes_idle_and_cancels_timers', () => {
    const { machine, advance, pending } = setup();
    machine.setAvailable(true);
    machine.pointer(true);
    advance(120);
    machine.pointer(false);
    machine.setAvailable(false);
    assert.equal(machine.mode, 'idle');
    assert.equal(pending(), 0);
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
