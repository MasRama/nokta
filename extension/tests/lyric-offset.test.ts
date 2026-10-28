import assert from 'node:assert/strict';
import { test } from 'node:test';

import { offsetLabel, OFFSET_STEP_MS, stepOffset } from '../src/features/lyrics/logic/offset.js';

test('no offset is on time', () => {
    assert.equal(offsetLabel(0), 'On time');
});

test('a positive offset shows the lyrics earlier, a negative one later', () => {
    assert.equal(offsetLabel(500), '0.5 s earlier');
    assert.equal(offsetLabel(-250), '0.25 s later');
    assert.equal(offsetLabel(1_000), '1 s earlier');
    assert.equal(offsetLabel(-1_750), '1.75 s later');
    assert.equal(offsetLabel(30_000), '30 s earlier');
});

test('an offset set elsewhere is rounded to hundredths', () => {
    assert.equal(offsetLabel(333), '0.33 s earlier');
    assert.equal(offsetLabel(-1_005), '1.01 s later');
    assert.equal(offsetLabel(4), 'On time');
});

test('each click moves a quarter second, at most thirty either way', () => {
    assert.equal(OFFSET_STEP_MS, 250);
    assert.equal(stepOffset(0, 1), 250);
    assert.equal(stepOffset(250, -1), 0);
    assert.equal(stepOffset(-500, -1), -750);
    assert.equal(stepOffset(29_900, 1), 30_000);
    assert.equal(stepOffset(-30_000, -1), -30_000);
});
