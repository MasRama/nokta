import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BACKDROP_DARKEN, backdropFor, backdropPalette } from '../src/shared/logic/backdrop.js';

const COLORS = { background: '#000000', backgroundOpacity: 1, foreground: '#ffffff', accent: '#ffffff', useAlbumAccent: true };
const BACKDROP = '/cache/art/abc.backdrop.png';

test('the backdrop shows only on the open player, with the switch on and a cover', () => {
    assert.equal(backdropFor({ on: false, view: 'expanded', backdrop: BACKDROP }), null);
    assert.equal(backdropFor({ on: true, view: 'panel', backdrop: BACKDROP }), null);
    assert.equal(backdropFor({ on: true, view: 'collapsed', backdrop: BACKDROP }), null);
    assert.equal(backdropFor({ on: true, view: 'expanded', backdrop: '' }), null);
    assert.equal(backdropFor({ on: true, view: 'expanded', backdrop: BACKDROP }), BACKDROP);
});

test('over the backdrop the text is white and the cover darkened', () => {
    const p = backdropPalette(COLORS, '#3aa0ff', BACKDROP);
    assert.equal(p.theme, 'picture');
    assert.equal(p.foreground, '#ffffff');
    assert.equal(p.light, false);
    assert.deepEqual(p.picture, { path: BACKDROP, darken: BACKDROP_DARKEN });
    assert.equal(BACKDROP_DARKEN, 0.45);
    assert.equal(p.accent, '#3aa0ff');
});

test("the accent is white when the cover's color is off or missing", () => {
    assert.equal(backdropPalette({ ...COLORS, useAlbumAccent: false }, '#d02030', BACKDROP).accent, '#ffffff');
    assert.equal(backdropPalette(COLORS, null, BACKDROP).accent, '#ffffff');
    assert.equal(backdropPalette(COLORS, null, BACKDROP).onAccent, '#000000');
});

test('a very dark cover color is lifted so the accent shows on the darkened cover', () => {
    const p = backdropPalette(COLORS, '#101018', BACKDROP);
    assert.notEqual(p.accent, '#101018');
});
