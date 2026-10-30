import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TOUR_STEPS, tourAfter, tourStep } from '../src/features/tour/logic/steps.js';

const hover = { openOn: 'hover', shortcut: '<Super><Alt>n' } as const;

test('the tour has four steps, settings last', () => {
    assert.equal(TOUR_STEPS, 4);
    const steps = [0, 1, 2, 3].map((i) => tourStep(i, hover));
    assert.deepEqual(
        steps.map((s) => s.title),
        ['This is Nokta', 'Open it', 'Home', 'Make it yours'],
    );
    assert.deepEqual(
        steps.map((s) => [s.last, s.settings]),
        [
            [false, false],
            [false, false],
            [false, false],
            [true, true],
        ],
    );
});

test('opening says how the notch opens and names the shortcut', () => {
    assert.equal(tourStep(1, hover).body, 'Rest the pointer on it or press Super+Alt+N.');
    assert.equal(tourStep(1, { ...hover, openOn: 'click' }).body, 'Click it or press Super+Alt+N.');
});

test('with no shortcut the step leaves it out', () => {
    assert.equal(tourStep(1, { ...hover, shortcut: '' }).body, 'Rest the pointer on it.');
    assert.equal(tourStep(1, { openOn: 'click', shortcut: ' ' }).body, 'Click it.');
});

test('Next walks the steps and is done after the last', () => {
    assert.equal(tourAfter(0, 'next'), 1);
    assert.equal(tourAfter(2, 'next'), 3);
    assert.equal(tourAfter(3, 'next'), null);
});

test('Skip is done from any step', () => {
    for (let i = 0; i < TOUR_STEPS; i++) assert.equal(tourAfter(i, 'skip'), null);
});
