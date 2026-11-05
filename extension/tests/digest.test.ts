import assert from 'node:assert/strict';
import { test } from 'node:test';

import { arrivedSince, digestLines, FocusDigest, tally } from '../src/features/notifications/logic/digest.js';

test('notifications are counted by app, most first', () => {
    assert.deepEqual(tally(['Slack', 'Mail', 'Slack', 'WhatsApp', 'Slack', 'WhatsApp']), [
        { app: 'Slack', count: 3 },
        { app: 'WhatsApp', count: 2 },
        { app: 'Mail', count: 1 },
    ]);
    // A tie goes by name, so the digest reads the same each time.
    assert.deepEqual(tally(['b', 'a']), [
        { app: 'a', count: 1 },
        { app: 'b', count: 1 },
    ]);
    assert.deepEqual(tally([]), []);
});

test('the digest names the two busiest apps and counts the rest', () => {
    assert.equal(digestLines([]), null);
    assert.deepEqual(digestLines(['Slack']), { title: '1 notification while you focused', detail: 'Slack' });
    assert.deepEqual(digestLines(['Slack', 'Slack', 'Mail']), {
        title: '3 notifications while you focused',
        detail: 'Slack 2 · Mail 1',
    });
    assert.deepEqual(digestLines(['Slack', 'Slack', 'Mail', 'Signal', 'Teams', 'Teams', 'Teams']), {
        title: '7 notifications while you focused',
        detail: 'Teams 3 · Slack 2 · 2 more',
    });
});

test('an app without a name is still counted', () => {
    assert.deepEqual(digestLines(['', '  ']), { title: '2 notifications while you focused', detail: 'Other apps 2' });
});

test('only notifications that came after the start are missed ones', () => {
    const [a, b, c] = [{}, {}, {}];
    const before = new Set([a]);
    const now = [
        { item: a, app: 'Mail' },
        { item: b, app: 'Slack' },
        { item: c, app: 'Slack' },
    ];
    assert.deepEqual(arrivedSince(before, now), ['Slack', 'Slack']);
});

test('the digest comes when quiet focus ends, once', () => {
    const digest = new FocusDigest();
    assert.equal(digest.update(false), 'none');
    assert.equal(digest.update(true), 'start');
    assert.equal(digest.update(true), 'none');
    assert.equal(digest.update(false), 'end');
    assert.equal(digest.update(false), 'none');
});

test('notifications counted while quiet are handed over at the end', () => {
    const digest = new FocusDigest();
    digest.add('Slack'); // Not quiet: not counted.
    digest.update(true);
    digest.add('Slack');
    digest.add('Mail');
    assert.equal(digest.quiet, true);
    digest.update(false);
    assert.deepEqual(digest.take(), ['Slack', 'Mail']);
    assert.deepEqual(digest.take(), []);
    // A new session starts again from nothing.
    digest.update(true);
    digest.add('Teams');
    digest.update(false);
    assert.deepEqual(digest.take(), ['Teams']);
});
