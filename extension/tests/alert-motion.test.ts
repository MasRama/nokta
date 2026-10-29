import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertMotion, motionKicks, type AlertMotion } from '../src/shared/logic/alert-motion.js';

test('each alert picks its own motion', () => {
    const rows: [string, AlertMotion][] = [
        ['bluetooth-connected', 'slide'],
        ['charger-plugged', 'fill'],
        ['battery-full', 'sweep'],
        ['battery-low', 'pulse'],
        ['battery-critical', 'pulse'],
        ['timer-done', 'ring'],
        ['clock-done', 'ring'],
        ['activity-done', 'pop'],
        ['activity-failed', 'shake'],
        ['calendar', 'kick'],
        ['bluetooth-disconnected', 'kick'],
        ['charger-unplugged', 'kick'],
    ];
    for (const [event, motion] of rows) assert.equal(alertMotion(event, true), motion, event);
});

test('an unknown alert kicks', () => {
    assert.equal(alertMotion('something-new', true), 'kick');
});

test('with alert_motion off every alert kicks', () => {
    for (const event of ['bluetooth-connected', 'battery-low', 'timer-done', 'activity-failed'])
        assert.equal(alertMotion(event, false), 'kick', event);
});

test('the pulse and the shake replace the kick', () => {
    assert.equal(motionKicks('pulse'), false);
    assert.equal(motionKicks('shake'), false);
    for (const motion of ['kick', 'slide', 'fill', 'sweep', 'ring', 'pop'] as const)
        assert.equal(motionKicks(motion), true, motion);
});
