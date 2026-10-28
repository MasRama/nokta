import assert from 'node:assert/strict';
import { test } from 'node:test';

import { notificationsLabel } from '../src/features/panel/logic/labels.js';

test('the notifications button counts what is in the message list', () => {
    assert.equal(notificationsLabel(0), 'No notifications');
    assert.equal(notificationsLabel(1), '1 notification');
    assert.equal(notificationsLabel(12), '12 notifications');
    // A GNOME that does not say how many.
    assert.equal(notificationsLabel(null), 'Notifications');
});
