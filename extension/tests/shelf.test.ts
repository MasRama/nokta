import assert from 'node:assert/strict';
import { test } from 'node:test';

import { itemAt, itemRects, SLOT_GAP, SLOT_WIDTH, CLOSE_SIZE } from '../src/features/shelf/logic/layout.js';
import { helperLine, parseHelperLine } from '../src/features/shelf/logic/protocol.js';
import { itemsFrom, pointIn, urisFromList, urisToList } from '../src/features/shelf/logic/items.js';

const STEP = SLOT_WIDTH + SLOT_GAP;

test('the stack comes first, then the newest files that fit', () => {
    assert.deepEqual(itemRects(0, 300), []);
    const rects = itemRects(3, 300);
    assert.deepEqual(rects, [
        { kind: 'stack', index: -1, x: 0, width: SLOT_WIDTH },
        { kind: 'item', index: 2, x: STEP, width: SLOT_WIDTH },
        { kind: 'item', index: 1, x: 2 * STEP, width: SLOT_WIDTH },
        { kind: 'item', index: 0, x: 3 * STEP, width: SLOT_WIDTH },
    ]);
});

test('files that do not fit are left out, oldest first', () => {
    // Room for the stack and exactly two files.
    const width = 3 * SLOT_WIDTH + 2 * SLOT_GAP;
    const rects = itemRects(5, width);
    assert.deepEqual(
        rects.map((r) => r.index),
        [-1, 4, 3],
    );
    assert.ok(rects.every((r) => r.x + r.width <= width));
    assert.deepEqual(itemRects(5, SLOT_WIDTH - 1), []);
});

test('itemAt finds the slot itemRects draws at that point', () => {
    const width = 360;
    for (const count of [1, 4, 30]) {
        for (const rect of itemRects(count, width)) {
            for (const x of [rect.x, rect.x + rect.width / 2, rect.x + rect.width - 1]) {
                const hit = itemAt(x, 30, count, width);
                assert.equal(hit?.index, rect.index, `count ${count} x ${x}`);
                assert.equal(hit?.kind, rect.kind);
            }
        }
    }
    // The gap between two slots and the space after the last one hit nothing.
    assert.equal(itemAt(SLOT_WIDTH + 1, 30, 4, width), null);
    assert.equal(itemAt(width - 1, 30, 1, width), null);
    assert.equal(itemAt(-1, 30, 4, width), null);
    assert.equal(itemAt(10, 30, 0, width), null);
});

test('the top right corner of a slot is its close button', () => {
    const corner = itemAt(STEP + SLOT_WIDTH - 2, 2, 3, 300);
    assert.deepEqual(corner, { kind: 'item', index: 2, close: true });
    assert.equal(itemAt(STEP + SLOT_WIDTH - 2, CLOSE_SIZE + 1, 3, 300)?.close, false);
    assert.equal(itemAt(STEP + 2, 2, 3, 300)?.close, false);
    assert.deepEqual(itemAt(SLOT_WIDTH - 2, 2, 3, 300), { kind: 'stack', index: -1, close: true });
});

test('helper lines go both ways', () => {
    const events = [
        { kind: 'enter' },
        { kind: 'leave' },
        { kind: 'hover', hit: null },
        { kind: 'hover', hit: { kind: 'stack', index: -1, close: true } },
        { kind: 'hover', hit: { kind: 'item', index: 7, close: false } },
        { kind: 'drag', active: true },
        { kind: 'drag', active: false },
    ] as const;
    for (const event of events) assert.deepEqual(parseHelperLine(helperLine(event)), event);
    assert.equal(helperLine({ kind: 'hover', hit: { kind: 'item', index: 7, close: false } }), 'hover item 7 open');
    for (const junk of ['', 'hover', 'hover item x open', 'hover item 3', 'drag maybe', 'Gtk-WARNING: oops'])
        assert.equal(parseHelperLine(junk), null, junk);
});

test('a text/uri-list has one URI per line and comments', () => {
    assert.deepEqual(urisFromList('# from Files\r\nfile:///tmp/a.txt\r\nfile:///tmp/b%20c.png\r\n\r\n'), [
        'file:///tmp/a.txt',
        'file:///tmp/b%20c.png',
    ]);
    assert.deepEqual(urisFromList('file:///tmp/a.txt'), ['file:///tmp/a.txt']);
    assert.deepEqual(urisFromList(''), []);
    assert.equal(urisToList(['file:///a', 'file:///b']), 'file:///a\r\nfile:///b\r\n');
});

test('Items from noktad become shelf items', () => {
    assert.deepEqual(itemsFrom([['file:///tmp/a.pdf', 'a.pdf', 'x-office-document']]), [
        { uri: 'file:///tmp/a.pdf', name: 'a.pdf', icon: 'x-office-document' },
    ]);
    assert.deepEqual(itemsFrom(undefined), []);
    assert.deepEqual(itemsFrom([['only one']]), []);
    assert.deepEqual(itemsFrom('nope'), []);
});

test('pointIn checks a rectangle, edges included on the top left', () => {
    const rect = { x: 10, y: 0, width: 100, height: 40 };
    assert.ok(pointIn(rect, 10, 0));
    assert.ok(pointIn(rect, 109, 39));
    assert.ok(!pointIn(rect, 110, 20));
    assert.ok(!pointIn(rect, 50, 40));
    assert.ok(!pointIn(rect, 9, 20));
});
