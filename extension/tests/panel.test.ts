import assert from 'node:assert/strict';
import { test } from 'node:test';

import { notificationBadge } from '../src/features/panel/logic/labels.js';

test('the notifications tile counts what is in the message list', () => {
    assert.equal(notificationBadge(0), null);
    assert.equal(notificationBadge(1), '1');
    assert.equal(notificationBadge(9), '9');
    assert.equal(notificationBadge(12), '9+');
    // A GNOME that does not say how many.
    assert.equal(notificationBadge(null), null);
});
