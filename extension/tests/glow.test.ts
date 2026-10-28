import assert from 'node:assert/strict';
import { test } from 'node:test';

import { glowColor } from '../src/shared/logic/glow.js';

test("an alert glows red when urgent, green for a success, in a timer's colour, else in the accent", () => {
    assert.equal(glowColor('urgent', '#123456'), '#ff453a');
    assert.equal(glowColor('success', '#123456'), '#30d158');
    assert.equal(glowColor({ color: '#ff9f0a' }, '#123456'), '#ff9f0a');
    assert.equal(glowColor('accent', '#123456'), '#123456');
});
