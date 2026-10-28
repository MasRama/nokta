import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shortcutAction, shortcutKeys } from '../src/features/timer/logic/shortcut.js';
import { EMPTY_TIMER } from '../src/features/timer/logic/timer.js';

test('the_shortcut_setting_becomes_a_key_list', () => {
    assert.deepEqual(shortcutKeys('<Super><Alt>f'), ['<Super><Alt>f']);
    assert.deepEqual(shortcutKeys('  <Control>F12 '), ['<Control>F12']);
    assert.deepEqual(shortcutKeys(''), []);
});

test('the_shortcut_starts_focus_or_stops_the_timer', () => {
    assert.equal(shortcutAction(EMPTY_TIMER), 'focus');
    assert.equal(shortcutAction({ ...EMPTY_TIMER, state: 'running', phase: 'break' }), 'stop');
    assert.equal(shortcutAction({ ...EMPTY_TIMER, state: 'paused', phase: 'focus' }), 'stop');
});

