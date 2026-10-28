import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    ageLabel,
    captureKind,
    entriesFrom,
    filterEntries,
    listHeight,
    pageHeight,
    SEARCH_HEIGHT,
    MAX_IMAGE_BYTES,
    scrolled,
    visibleRows,
} from '../src/features/clipboard/logic/entries.js';

test('Items from noktad become entries; malformed rows are skipped', () => {
    const raw = [
        ['2', 'image', '400 × 200', '/run/nokta/clipboard/2.png', false, 20],
        ['1', 'text', 'hello', '', true, 10],
        ['3', 'file', 'odd', '', false, 5],
        ['4', 'text', 'short row'],
    ];
    assert.deepEqual(entriesFrom(raw), [
        { id: '2', kind: 'image', preview: '400 × 200', thumbnail: '/run/nokta/clipboard/2.png', pinned: false, timeUs: 20 },
        { id: '1', kind: 'text', preview: 'hello', thumbnail: null, pinned: true, timeUs: 10 },
    ]);
    assert.deepEqual(entriesFrom(undefined), []);
});

test('text is kept before a picture, and nothing from a password manager', () => {
    assert.equal(captureKind(['text/plain;charset=utf-8', 'UTF8_STRING']), 'text');
    assert.equal(captureKind(['STRING']), 'text');
    assert.equal(captureKind(['image/png', 'text/plain']), 'text');
    assert.equal(captureKind(['image/png', 'text/html']), 'image');
    assert.equal(captureKind(['text/plain', 'x-kde-passwordManagerHint']), null);
    assert.equal(captureKind(['application/x-thing']), null);
    assert.equal(captureKind([]), null);
    assert.equal(MAX_IMAGE_BYTES, 8 * 1024 * 1024);
});

test('ages read now, minutes, hours and days', () => {
    const minute = 60_000_000;
    assert.equal(ageLabel(100 * minute, 100 * minute), 'now');
    assert.equal(ageLabel(100 * minute + 59_000_000, 100 * minute), 'now');
    assert.equal(ageLabel(105 * minute, 100 * minute), '5 min');
    assert.equal(ageLabel(100 * minute + 150 * minute, 100 * minute), '2 h');
    assert.equal(ageLabel(100 * minute + 3 * 24 * 60 * minute, 100 * minute), '3 d');
    assert.equal(ageLabel(0, 100 * minute), 'now', 'a clock that went back');
});

test('the page lists up to five rows and scrolls past that', () => {
    assert.equal(visibleRows(0), 1, 'room for the empty note');
    assert.equal(visibleRows(3), 3);
    assert.equal(visibleRows(25), 5);
});

test('the list is as tall as its rows, and a scroll moves one row inside the history', () => {
    assert.equal(listHeight(0), 32);
    assert.equal(listHeight(2), 2 * 32 + 4);
    assert.equal(listHeight(25), 5 * 32 + 4 * 4);
    assert.equal(scrolled(0, 1, 12), 1);
    assert.equal(scrolled(7, 1, 12), 7, 'the last five show');
    assert.equal(scrolled(0, -1, 12), 0);
    assert.equal(scrolled(9, 0, 6), 1, 'a shorter history pulls it back');
    assert.equal(scrolled(3, 1, 4), 0, 'all of it fits');
});

const entry = (id: string, kind: 'text' | 'image', preview: string) => ({
    id,
    kind,
    preview,
    thumbnail: null,
    pinned: false,
    timeUs: 0,
});

test('a search keeps the entries whose text has the query, in order', () => {
    const entries = [entry('1', 'text', 'Hello World'), entry('2', 'text', 'goodbye'), entry('3', 'text', 'WORLD cup')];
    assert.deepEqual(
        filterEntries(entries, 'world').map((e) => e.id),
        ['1', '3'],
    );
});

test('an empty or blank search keeps everything', () => {
    const entries = [entry('1', 'text', 'a'), entry('2', 'image', '10 × 10')];
    assert.equal(filterEntries(entries, '').length, 2);
    assert.equal(filterEntries(entries, '   ').length, 2);
});

test('a search ignores case and accents and trims the query', () => {
    const entries = [entry('1', 'text', 'Café crème'), entry('2', 'text', 'cafe'), entry('3', 'text', 'tea')];
    assert.deepEqual(
        filterEntries(entries, '  CAFE ').map((e) => e.id),
        ['1', '2'],
    );
});

test('pictures match picture and their size', () => {
    const entries = [entry('1', 'image', '400 × 200'), entry('2', 'text', 'a picture frame'), entry('3', 'text', 'x')];
    assert.deepEqual(
        filterEntries(entries, 'picture').map((e) => e.id),
        ['1', '2'],
    );
    assert.deepEqual(
        filterEntries(entries, '400').map((e) => e.id),
        ['1'],
    );
});

test('the search row adds its height to the page', () => {
    assert.equal(pageHeight(3, false), listHeight(3));
    assert.equal(pageHeight(3, true), SEARCH_HEIGHT + 4 + listHeight(3));
    assert.equal(pageHeight(0, true), SEARCH_HEIGHT + 4 + listHeight(0));
});
