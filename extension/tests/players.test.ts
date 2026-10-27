import assert from 'node:assert/strict';
import { test } from 'node:test';

import { neighbour, playerLabels, scrollStep } from '../src/features/media/logic/players.js';

const players: Array<[string, string]> = [
    [':1.10', 'Spotify'],
    [':1.20', 'Google Chrome'],
    [':1.30', 'Google Chrome'],
];

test('labels_number_players_with_the_same_name', () => {
    assert.deepEqual(playerLabels(players), ['Spotify', 'Google Chrome', 'Google Chrome 2']);
    assert.deepEqual(playerLabels([[':1.1', '']]), ['Player']);
});

test('neighbour_wraps_around_the_list', () => {
    assert.equal(neighbour(players, ':1.10', 1), ':1.20');
    assert.equal(neighbour(players, ':1.30', 1), ':1.10');
    assert.equal(neighbour(players, ':1.10', -1), ':1.30');
});

test('neighbour_needs_two_players_and_a_known_active_one', () => {
    assert.equal(neighbour([[':1.10', 'Spotify']], ':1.10', 1), null);
    assert.equal(neighbour(players, ':1.99', 1), null);
    assert.equal(neighbour([], '', 1), null);
});

test('scroll_steps_on_wheel_clicks_and_ignores_smooth_scrolling', () => {
    assert.equal(scrollStep('down', 1000, 0), 1);
    assert.equal(scrollStep('right', 1000, 0), 1);
    assert.equal(scrollStep('up', 1000, 0), -1);
    assert.equal(scrollStep('left', 1000, 0), -1);
    assert.equal(scrollStep('smooth', 1000, 0), 0);
});

test('scroll_waits_between_switches', () => {
    assert.equal(scrollStep('down', 1100, 1000), 0);
    assert.equal(scrollStep('down', 1250, 1000), 1);
});
