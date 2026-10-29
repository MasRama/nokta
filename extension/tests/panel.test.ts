import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anchorRow } from '../src/features/panel/logic/anchor.js';
import type { PanelRow } from '../src/features/panel/logic/height.js';
import { notificationBadge } from '../src/features/panel/logic/labels.js';
import { shownControls } from '../src/features/panel/logic/layout.js';
import { LIFT, POP, popsOn } from '../src/features/panel/logic/motion.js';

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

test("a toggle's icon pops only when it turns on", () => {
    assert.equal(popsOn(false, true), true);
    assert.equal(popsOn(true, true), false);
    assert.equal(popsOn(true, false), false);
    assert.equal(popsOn(false, false), false);
});

test('the pop grows the icon a little and a tile under the pointer rises 2 px', () => {
    assert.deepEqual(POP, { from: 1, peak: 1.18, upMs: 110, downMs: 150 });
    assert.deepEqual(LIFT, { y: -2, scale: 1.05, ms: 150 });
});

test('each indicator flies to its own row in home', () => {
    const rows: PanelRow[] = ['date', 'event', 'recording', 'call', 'activity', 'clock', 'shelf', 'toggles', 'tiles'];
    assert.equal(anchorRow('recording', rows), 'recording');
    assert.equal(anchorRow('call', rows), 'call');
    assert.equal(anchorRow('clock', rows), 'clock');
    assert.equal(anchorRow('activity', rows), 'activity');
    assert.equal(anchorRow('meeting', rows), 'event');
    assert.equal(anchorRow('shelf', rows), 'shelf');
    assert.equal(anchorRow('timer', rows), 'focus-tile');
});

test('an indicator whose row home does not show does not fly', () => {
    const rows: PanelRow[] = ['date', 'toggles'];
    for (const indicator of ['recording', 'call', 'clock', 'activity', 'meeting', 'shelf', 'timer'] as const)
        assert.equal(anchorRow(indicator, rows), null, indicator);
});
