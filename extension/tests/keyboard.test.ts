import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KEYS, keyAction } from '../src/shared/logic/keyboard.js';

test('escape_closes_and_tab_moves_focus_both_ways', () => {
    assert.equal(keyAction(KEYS.Escape, false), 'close');
    assert.equal(keyAction(KEYS.Tab, false), 'next');
    assert.equal(keyAction(KEYS.Tab, true), 'previous');
    // Shift+Tab arrives as ISO_Left_Tab.
    assert.equal(keyAction(KEYS.ISO_Left_Tab, true), 'previous');
    assert.equal(keyAction(KEYS.ISO_Left_Tab, false), 'previous');
});

test('the_arrows_move_focus_by_direction', () => {
    assert.equal(keyAction(KEYS.Up, false), 'up');
    assert.equal(keyAction(KEYS.Down, false), 'down');
    assert.equal(keyAction(KEYS.Left, false), 'left');
    assert.equal(keyAction(KEYS.Right, false), 'right');
});

test('other_keys_are_left_to_the_focused_button', () => {
    // Enter and Space press the focused St.Button itself.
    assert.equal(keyAction(0xff0d, false), null);
    assert.equal(keyAction(0x20, false), null);
    assert.equal(keyAction(0x61, false), null);
});
