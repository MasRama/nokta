import assert from 'node:assert/strict';
import { test } from 'node:test';

import { weatherIcon, weatherLine, weatherText } from '../src/features/weather/logic/weather.js';

const READY = {
    Status: 'ready',
    Place: 'Jakarta',
    Temperature: 31.2,
    High: 33.4,
    Low: 25.1,
    Units: 'celsius',
    Condition: 'partly-cloudy',
    IsDay: true,
};

test('each condition has a day and a night icon', () => {
    assert.equal(weatherIcon('clear', true), 'weather-clear-symbolic');
    assert.equal(weatherIcon('clear', false), 'weather-clear-night-symbolic');
    assert.equal(weatherIcon('partly-cloudy', true), 'weather-few-clouds-symbolic');
    assert.equal(weatherIcon('partly-cloudy', false), 'weather-few-clouds-night-symbolic');
    assert.equal(weatherIcon('cloudy', false), 'weather-overcast-symbolic');
    assert.equal(weatherIcon('fog', true), 'weather-fog-symbolic');
    assert.equal(weatherIcon('drizzle', true), 'weather-showers-scattered-symbolic');
    assert.equal(weatherIcon('rain', true), 'weather-showers-symbolic');
    assert.equal(weatherIcon('showers', true), 'weather-showers-symbolic');
    assert.equal(weatherIcon('snow', true), 'weather-snow-symbolic');
    assert.equal(weatherIcon('thunderstorm', true), 'weather-storm-symbolic');
    assert.equal(weatherIcon('unknown', true), 'weather-overcast-symbolic');
    assert.equal(weatherIcon('something new', true), 'weather-overcast-symbolic');
});

test('temperatures are whole degrees', () => {
    assert.equal(weatherText(31.2), '31°');
    assert.equal(weatherText(31.5), '32°');
    assert.equal(weatherText(-0.4), '0°');
    assert.equal(weatherText(-3.6), '-4°');
});

test('a ready reading gives the panel line', () => {
    assert.deepEqual(weatherLine(READY), {
        icon: 'weather-few-clouds-symbolic',
        temperature: '31°',
        detail: 'Jakarta · 33° / 25°',
    });
    assert.deepEqual(weatherLine({ ...READY, Place: '' }), {
        icon: 'weather-few-clouds-symbolic',
        temperature: '31°',
        detail: '33° / 25°',
    });
});

test('nothing shows unless the reading is ready', () => {
    for (const Status of ['off', 'loading', 'error', '']) {
        assert.equal(weatherLine({ ...READY, Status }), null, Status);
    }
    assert.equal(weatherLine({}), null);
    assert.equal(weatherLine({ ...READY, Temperature: Number.NaN }), null);
    assert.equal(weatherLine({ ...READY, High: 'hot' }), null);
});
