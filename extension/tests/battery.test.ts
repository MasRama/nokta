import assert from 'node:assert/strict';
import { test } from 'node:test';

import { batteryLevel } from '../src/features/devices/logic/battery.js';
import { batteryFill, batteryTone } from '../src/features/osd/logic/battery.js';
import { TONES } from '../src/shared/logic/tones.js';

test('an alert shows a battery only for a level the device reported', () => {
    assert.equal(batteryLevel(82), 82);
    assert.equal(batteryLevel(0), 0);
    assert.equal(batteryLevel(100), 100);
    assert.equal(batteryLevel(-1), null);
    assert.equal(batteryLevel(101), null);
    assert.equal(batteryLevel(50.5), null);
});

test('the battery is red when nearly out, amber when low and green otherwise', () => {
    assert.equal(batteryTone(5), TONES.urgent);
    assert.equal(batteryTone(10), TONES.urgent);
    assert.equal(batteryTone(11), TONES.countdown);
    assert.equal(batteryTone(20), TONES.countdown);
    assert.equal(batteryTone(21), TONES.success);
    assert.equal(batteryTone(100), TONES.success);
});

test('the fill grows with the level and never vanishes while some charge is left', () => {
    assert.equal(batteryFill(100, 18), 18);
    assert.equal(batteryFill(50, 18), 9);
    assert.equal(batteryFill(1, 18), 1);
    assert.equal(batteryFill(0, 18), 0);
});
