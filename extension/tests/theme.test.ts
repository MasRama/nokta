import assert from 'node:assert/strict';
import { test } from 'node:test';

import { luminance, mix } from '../src/shared/logic/color.js';
import { gradientDirection, paletteFor, themeFor, themeKeyFor, THEMES, type ThemeColors } from '../src/shared/logic/theme.js';

const COLORS: ThemeColors = {
    background: '#102030',
    backgroundOpacity: 0.8,
    foreground: '#eeeeee',
    accent: '#ff8800',
    useAlbumAccent: true,
};
const COVER = '#3366cc';

test('colors mix and have a luminance', () => {
    assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
    assert.equal(mix('#ff0000', '#0000ff', 0), '#ff0000');
    assert.equal(luminance('#000000'), 0);
    assert.equal(luminance('#ffffff'), 1);
    assert.ok(luminance('#ffff00') > luminance('#0000ff'));
});

test('midnight is black with the cover accent, and the default', () => {
    const p = paletteFor('midnight', COLORS, COVER);
    assert.equal(p.background, '#000000');
    assert.equal(p.backgroundOpacity, 1);
    assert.equal(p.foreground, '#ffffff');
    assert.equal(p.accent, COVER);
    assert.equal(p.gradient, null);
    assert.deepEqual(paletteFor('neon', COLORS, COVER), p);
});

test('without a cover or with the cover accent off, the theme accent shows', () => {
    assert.equal(paletteFor('midnight', COLORS, null).accent, '#ffffff');
    assert.equal(paletteFor('midnight', { ...COLORS, useAlbumAccent: false }, COVER).accent, '#ffffff');
    assert.equal(paletteFor('midnight', COLORS, 'not a color').accent, '#ffffff');
});

test('custom uses the colors from the settings', () => {
    const p = paletteFor('custom', COLORS, null);
    assert.equal(p.background, '#102030');
    assert.equal(p.backgroundOpacity, 0.8);
    assert.equal(p.foreground, '#eeeeee');
    assert.equal(p.accent, '#ff8800');
    assert.equal(paletteFor('custom', COLORS, COVER).accent, COVER);
});

test('custom runs from its color to the second color in the chosen direction', () => {
    const flat = paletteFor('custom', COLORS, null);
    assert.equal(flat.gradient, null);
    assert.deepEqual(flat.direction, [0, 1]);
    const across = paletteFor('custom', { ...COLORS, gradient: 'across', backgroundEnd: '#405060' }, null);
    assert.equal(across.gradient, '#405060');
    assert.deepEqual(across.direction, [1, 0]);
    const down = paletteFor('custom', { ...COLORS, gradient: 'down', backgroundEnd: '#405060' }, null);
    assert.deepEqual([down.gradient, down.direction], ['#405060', [0, 1]]);
});

test('a gradient direction is a unit vector, down when unknown', () => {
    assert.deepEqual(gradientDirection('down'), [0, 1]);
    assert.deepEqual(gradientDirection('across'), [1, 0]);
    assert.deepEqual(gradientDirection('diagonal'), [Math.SQRT1_2, Math.SQRT1_2]);
    assert.deepEqual(gradientDirection('none'), [0, 1]);
    assert.deepEqual(gradientDirection('up'), [0, 1]);
});

test('the other themes run their gradient downward, whatever the custom setting', () => {
    for (const theme of ['midnight', 'graphite', 'glass', 'aurora', 'paper'])
        assert.deepEqual(paletteFor(theme, { ...COLORS, gradient: 'across' }, COVER).direction, [0, 1], theme);
});

test('graphite and glass have a hairline edge, glass is see-through', () => {
    const graphite = paletteFor('graphite', COLORS, COVER);
    assert.equal(graphite.background, '#1c1c1e');
    assert.notEqual(graphite.border, null);
    const glass = paletteFor('glass', COLORS, COVER);
    assert.ok(glass.backgroundOpacity < 1);
    assert.notEqual(glass.border, null);
    assert.notEqual(glass.gradient, null);
});

test('aurora tints the notch with a dark shade of the cover', () => {
    const p = paletteFor('aurora', COLORS, COVER);
    assert.notEqual(p.background, '#000000');
    assert.ok(luminance(p.background) < 0.08, 'dark enough for white text');
    assert.ok(p.gradient !== null && luminance(p.gradient) <= luminance(p.background));
    // Without a cover it is midnight.
    assert.deepEqual(paletteFor('aurora', COLORS, null), paletteFor('midnight', COLORS, null));
});

test('paper is light with dark text and an accent that reads on it', () => {
    const p = paletteFor('paper', COLORS, '#ffee88');
    assert.ok(luminance(p.background) > 0.8);
    assert.ok(luminance(p.foreground) < 0.1);
    assert.ok(luminance(p.accent) < 0.45, `accent ${p.accent}`);
    assert.equal(p.light, true);
    assert.equal(paletteFor('midnight', COLORS, null).light, false);
});

test('text on the accent stays readable', () => {
    assert.equal(paletteFor('midnight', COLORS, '#ffffff').onAccent, '#000000');
    assert.equal(paletteFor('midnight', COLORS, '#202060').onAccent, '#ffffff');
});

test('every theme the daemon accepts has a palette', () => {
    assert.deepEqual([...THEMES], ['midnight', 'graphite', 'glass', 'aurora', 'paper', 'custom']);
    for (const theme of THEMES) assert.ok(paletteFor(theme, COLORS, COVER).background.startsWith('#'));
});

test('the theme follows the system style only while that is on', () => {
    const off = { theme: 'midnight', followSystemStyle: false, lightTheme: 'paper' };
    assert.equal(themeFor(off, false), 'midnight');
    assert.equal(themeFor(off, true), 'midnight');
    const on = { ...off, followSystemStyle: true };
    assert.equal(themeFor(on, true), 'midnight');
    assert.equal(themeFor(on, false), 'paper');
});

test('a theme picked from the notch goes to the key in use under the current style', () => {
    const off = { theme: 'midnight', followSystemStyle: false, lightTheme: 'paper' };
    assert.equal(themeKeyFor(off, false), 'theme');
    const on = { ...off, followSystemStyle: true };
    assert.equal(themeKeyFor(on, true), 'theme');
    assert.equal(themeKeyFor(on, false), 'light_theme');
});
