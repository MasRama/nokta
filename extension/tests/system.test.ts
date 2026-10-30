import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    cpuLabel,
    memoryAlert,
    memoryLabel,
    networkLabel,
    rateLabel,
    temperatureLabel,
    usageFrom,
} from '../src/features/system/logic/format.js';
import { History, HISTORY_LENGTH } from '../src/features/system/logic/history.js';
import { DEFAULT_SYSTEM, HOME_TILES, systemFrom } from '../src/features/settings/logic/parse.js';

test('cpu use reads as a whole percentage', () => {
    assert.equal(cpuLabel(0), '0%');
    assert.equal(cpuLabel(0.423), '42%');
    assert.equal(cpuLabel(1), '100%');
});

test('memory reads in the unit of its total', () => {
    assert.equal(memoryLabel(5_100_000_000, 15_400_000_000), '5.1 / 15.4 GB');
    assert.equal(memoryLabel(812_000_000, 15_400_000_000), '0.8 / 15.4 GB');
    assert.equal(memoryLabel(300_000_000, 900_000_000), '300.0 / 900.0 MB');
});

test('network rates read per second', () => {
    assert.equal(rateLabel(1_200_000), '1.2 MB/s');
    assert.equal(rateLabel(812.4), '812 B/s');
    assert.equal(networkLabel(1_200_000, 40_000), '↓ 1.2 MB/s  ↑ 40.0 kB/s');
});

test('the temperature follows the weather units', () => {
    assert.equal(temperatureLabel(45.4, false), '45 °C');
    assert.equal(temperatureLabel(45, true), '113 °F');
    assert.equal(temperatureLabel(Number.NaN, false), '–');
});

test('a sample comes from the Usage property', () => {
    assert.deepEqual(usageFrom([0.5, 5, 10, 40, 100, 20]), {
        cpu: 0.5,
        memoryUsed: 5,
        memoryTotal: 10,
        temperature: 40,
        download: 100,
        upload: 20,
    });
    // All zero while nobody watches: no sample yet.
    assert.equal(usageFrom([0, 0, 0, Number.NaN, 0, 0]), null);
    assert.equal(usageFrom([0.5, 5]), null);
    assert.equal(usageFrom(null), null);
});

test('the history keeps the last 30 samples', () => {
    const history = new History();
    for (let i = 0; i < HISTORY_LENGTH + 5; i++) history.push(i);
    const values = history.values();
    assert.equal(HISTORY_LENGTH, 30);
    assert.equal(values.length, 30);
    assert.equal(values[0], 5);
    assert.equal(values[29], 34);
    history.clear();
    assert.deepEqual(history.values(), []);
});

// The alert is as wide as any other (`osd_width`), so its detail is short.
test('the memory alert names the app using the most, or the memory without one', () => {
    assert.deepEqual(memoryAlert(14_800_000_000, 15_400_000_000, 'firefox'), {
        title: 'Memory is almost full',
        detail: 'firefox',
    });
    assert.deepEqual(memoryAlert(14_800_000_000, 15_400_000_000, ''), {
        title: 'Memory is almost full',
        detail: '14.8 / 15.4 GB',
    });
});

test('system settings from table', () => {
    assert.deepEqual(DEFAULT_SYSTEM, { memoryAlert: true });
    assert.deepEqual(systemFrom({ memory_alert: false }), { memoryAlert: false });
    assert.deepEqual(systemFrom({ memory_alert: 1 }), DEFAULT_SYSTEM);
    assert.ok(HOME_TILES.includes('system'));
});
