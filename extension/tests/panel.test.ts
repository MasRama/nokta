import assert from 'node:assert/strict';
import { test } from 'node:test';

import { notificationBadge } from '../src/features/panel/logic/labels.js';
import { shownControls } from '../src/features/panel/logic/layout.js';

test('the notifications tile counts what is in the message list', () => {
    assert.equal(notificationBadge(0), null);
    assert.equal(notificationBadge(1), '1');
    assert.equal(notificationBadge(9), '9');
    assert.equal(notificationBadge(12), '9+');
    // A GNOME that does not say how many.
    assert.equal(notificationBadge(null), null);
});

test('home shows the chosen toggles and tiles that it can offer, in order', () => {
    const toggles = { do_not_disturb: false, caffeine: true, dark_style: false, night_light: false };
    const layout = { toggles: ['night_light', 'caffeine'] as const, tiles: ['screenshot', 'clipboard', 'focus'] as const };
    assert.deepEqual(shownControls(layout, toggles, true), {
        toggles: ['night_light', 'caffeine'],
        tiles: ['screenshot', 'clipboard', 'focus'],
    });
    // No Night Light in this GNOME, no clipboard history.
    assert.deepEqual(shownControls(layout, { ...toggles, night_light: null }, false), {
        toggles: ['caffeine'],
        tiles: ['screenshot', 'focus'],
    });
});
