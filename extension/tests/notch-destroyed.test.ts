import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

// GNOME 50 and later destroy the notch themselves when the shell shuts
// down, while the session still holds it and its clients still report
// changes. So every method the session calls must do nothing once the
// notch is gone, or it touches actors that were already disposed.
const PUBLIC_METHOD = /^ {4}([a-z][A-Za-z]*)\([^)\n]*\)(?::[^{\n]+)? \{\n(.*)\n/gm;
// destroy() and canShow() read the flag themselves; the drop rects are plain
// geometry from the monitor's numbers and touch no actor.
const EXEMPT = new Set(['destroy', 'canShow', 'dropTrigger', 'dropRect']);

test('every public method of the notch returns early once it is destroyed', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/monitor-notch.ts'), 'utf8');
    const methods = [...source.matchAll(PUBLIC_METHOD)].filter(([, name]) => !EXEMPT.has(name));
    assert.ok(methods.length > 15, `only ${methods.length} methods were read`);
    const unguarded = methods.filter(([, , first]) => !/^\s*if \(this\.destroyed\b/.test(first)).map(([, name]) => name);
    assert.deepEqual(unguarded, []);
});
