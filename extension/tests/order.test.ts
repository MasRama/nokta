import assert from 'node:assert/strict';
import { test } from 'node:test';

import { moveItem, orderItems, switchItem } from '../src/features/settings/logic/order.js';

const OPTIONS = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C' },
    { value: 'd', label: 'D' },
];

test('the chosen items come first in their order, then the rest', () => {
    assert.deepEqual(
        orderItems(['c', 'a'], OPTIONS, 3).map(({ value, on }) => [value, on]),
        [
            ['c', true],
            ['a', true],
            ['b', false],
            ['d', false],
        ],
    );
});

test('only chosen items move, and not past the ends', () => {
    const items = orderItems(['c', 'a'], OPTIONS, 3);
    assert.deepEqual(
        items.map(({ canUp, canDown }) => [canUp, canDown]),
        [
            [false, true],
            [true, false],
            [false, false],
            [false, false],
        ],
    );
});

test('a full list lets no more items in', () => {
    const items = orderItems(['a', 'b', 'c'], OPTIONS, 3);
    assert.deepEqual(
        items.map(({ value, canSwitch }) => [value, canSwitch]),
        [
            ['a', true],
            ['b', true],
            ['c', true],
            ['d', false],
        ],
    );
});

test('names the list does not know are left out', () => {
    assert.deepEqual(
        orderItems(['x', 'b'], OPTIONS, 3).map((item) => item.value),
        ['b', 'a', 'c', 'd'],
    );
});

test('switching adds at the end or removes', () => {
    assert.deepEqual(switchItem(['c'], 'a', true, 3), ['c', 'a']);
    assert.deepEqual(switchItem(['c', 'a'], 'c', false, 3), ['a']);
    // Already there, or no room.
    assert.deepEqual(switchItem(['c'], 'c', true, 3), ['c']);
    assert.deepEqual(switchItem(['a', 'b', 'c'], 'd', true, 3), ['a', 'b', 'c']);
});

test('moving swaps with the neighbour', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 'd', 1), ['a', 'b', 'c']);
});
