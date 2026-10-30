import assert from 'node:assert/strict';
import { test } from 'node:test';

import { orGnome } from '../src/shared/logic/guard.js';

test("nokta's part runs and GNOME's does not while it works", () => {
    const reported: unknown[] = [];
    let gnomeRan = false;
    const result = orGnome(
        () => 'nokta',
        () => {
            gnomeRan = true;
            return 'gnome';
        },
        (error) => reported.push(error),
    );
    assert.equal(result, 'nokta');
    assert.equal(gnomeRan, false);
    assert.deepEqual(reported, []);
});

test("a nokta part that throws is reported and GNOME's own part runs instead", () => {
    const reported: unknown[] = [];
    const broken = new Error('broken');
    const result = orGnome(
        () => {
            throw broken;
        },
        () => 'gnome',
        (error) => reported.push(error),
    );
    assert.equal(result, 'gnome');
    assert.deepEqual(reported, [broken]);
});
