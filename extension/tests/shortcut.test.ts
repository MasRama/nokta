import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shortcutAction } from '../src/features/timer/logic/shortcut.js';
import { shortcutKeys, shortcutLabel } from '../src/shared/logic/shortcut.js';
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

test('the_shortcut_reads_as_keys_joined_by_plus', () => {
    assert.equal(shortcutLabel('<Super><Alt>n'), 'Super+Alt+N');
    assert.equal(shortcutLabel('<Control><Shift>F12'), 'Ctrl+Shift+F12');
    assert.equal(shortcutLabel('<Primary>space'), 'Ctrl+Space');
    assert.equal(shortcutLabel(' <Super>Return '), 'Super+Return');
    assert.equal(shortcutLabel(''), '');
    assert.equal(shortcutLabel('   '), '');
});
