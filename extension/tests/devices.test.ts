import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deviceAlert, isBatteryWarning } from '../src/features/devices/logic/alert.js';

test('bluetooth_connected_shows_name_and_battery', () => {
    assert.deepEqual(deviceAlert('bluetooth-connected', 'Galaxy Buds2', 82), {
        icon: 'audio-headphones-symbolic',
        title: 'Galaxy Buds2',
        detail: '82%',
        urgent: false,
    });
});

test('bluetooth_connected_without_battery_shows_connected', () => {
    assert.deepEqual(deviceAlert('bluetooth-connected', 'Galaxy Buds2', -1), {
        icon: 'audio-headphones-symbolic',
        title: 'Galaxy Buds2',
        detail: 'Connected',
        urgent: false,
    });
});

test('bluetooth_disconnected', () => {
    assert.deepEqual(deviceAlert('bluetooth-disconnected', 'Galaxy Buds2', -1), {
        icon: 'audio-headphones-symbolic',
        title: 'Galaxy Buds2',
        detail: 'Disconnected',
        urgent: false,
    });
});

test('empty_name_says_bluetooth_device', () => {
    assert.equal(deviceAlert('bluetooth-connected', '', 50)?.title, 'Bluetooth device');
    assert.equal(deviceAlert('bluetooth-disconnected', '  ', -1)?.title, 'Bluetooth device');
});

test('charger_alerts', () => {
    assert.deepEqual(deviceAlert('charger-plugged', '', 76), {
        icon: 'battery-good-charging-symbolic',
        title: 'Charging',
        detail: '76%',
        urgent: false,
    });
    assert.deepEqual(deviceAlert('charger-unplugged', '', 76), {
        icon: 'battery-good-symbolic',
        title: 'On battery',
        detail: '76%',
        urgent: false,
    });
});

test('battery_alerts', () => {
    assert.deepEqual(deviceAlert('battery-low', '', 20), {
        icon: 'battery-low-symbolic',
        title: 'Battery low',
        detail: '20%',
        urgent: false,
    });
    assert.deepEqual(deviceAlert('battery-critical', '', 9), {
        icon: 'battery-caution-symbolic',
        title: 'Battery critical',
        detail: '9%',
        urgent: true,
    });
    assert.deepEqual(deviceAlert('battery-full', '', 100), {
        icon: 'battery-full-charged-symbolic',
        title: 'Fully charged',
        detail: '100%',
        urgent: false,
    });
});

test('unknown_percentage_shows_no_detail', () => {
    assert.equal(deviceAlert('charger-plugged', '', -1)?.detail, '');
    assert.equal(deviceAlert('battery-low', '', Number.NaN)?.detail, '');
    assert.equal(deviceAlert('battery-low', '', 140)?.detail, '');
});

test('unknown_kind_is_ignored', () => {
    assert.equal(deviceAlert('wifi-connected', 'Home', -1), null);
});

test('battery_low_and_critical_are_battery_warnings', () => {
    assert.equal(isBatteryWarning('battery-low'), true);
    assert.equal(isBatteryWarning('battery-critical'), true);
    for (const kind of ['battery-full', 'charger-plugged', 'charger-unplugged', 'bluetooth-connected', 'other'])
        assert.equal(isBatteryWarning(kind), false, kind);
});
