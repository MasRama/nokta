import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromLevels } from '../src/features/osd/logic/levels.js';

test('no_entry_shows_nothing', () => {
    assert.equal(fromLevels({}, 0), null);
    assert.equal(fromLevels(null, 0), null);
    assert.equal(fromLevels({ 1: undefined }, 0), null);
});

test('one_entry_names_its_monitor', () => {
    assert.deepEqual(fromLevels({ 1: { level: 0.4, maxLevel: 1.5 } }, 0), { monitorIndex: 1, level: 0.4, maxLevel: 1.5 });
});

test('missing_maximum_is_left_to_the_content', () => {
    assert.deepEqual(fromLevels({ 0: { level: 0.7 } }, 0), { monitorIndex: 0, level: 0.7, maxLevel: undefined });
    assert.deepEqual(fromLevels({ 0: {} }, 0), { monitorIndex: 0, level: undefined, maxLevel: undefined });
});

test('several_entries_route_like_all_monitors', () => {
    const levels = { 2: { level: 0.2 }, 0: { level: 0.9 } };
    assert.deepEqual(fromLevels(levels, 2), { monitorIndex: -1, level: 0.2, maxLevel: undefined });
    // The preferred monitor has no entry: the lowest index wins.
    assert.deepEqual(fromLevels(levels, 1), { monitorIndex: -1, level: 0.9, maxLevel: undefined });
});
