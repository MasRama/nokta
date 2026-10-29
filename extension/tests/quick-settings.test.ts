import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOTION_PRESETS, motionPreset, themeSwatches } from '../src/features/settings/logic/quick.js';
import { paletteFor, THEMES } from '../src/shared/logic/theme.js';

const colors = {
    background: '#203040',
    backgroundOpacity: 1,
    foreground: '#ffffff',
    accent: '#ff6a3d',
    useAlbumAccent: true,
};

test('motion is fast, normal or slow', () => {
    assert.deepEqual(
        MOTION_PRESETS.map(({ label, speed }) => [label, speed]),
        [
            ['Fast', 0.75],
            ['Normal', 1],
            ['Slow', 1.5],
        ],
    );
});

test('the motion setting picks its preset, and a speed set by hand picks none', () => {
    assert.equal(motionPreset(0.75), 0);
    assert.equal(motionPreset(1), 1);
    assert.equal(motionPreset(1.5), 2);
    assert.equal(motionPreset(1.2), null);
});

test('there is one swatch per theme, in the themes order, with its label', () => {
    const swatches = themeSwatches(colors, null);
    assert.deepEqual(
        swatches.map((s) => s.theme),
        [...THEMES],
    );
    assert.deepEqual(
        swatches.map((s) => s.label),
        ['Midnight', 'Graphite', 'Glass', 'Aurora', 'Paper', 'Custom', 'Picture'],
    );
});

test('the picture swatch shows the picture, the others none', () => {
    const picture = { path: '/cache/sea.png', color: '#3060c0', tone: '#203040', darken: 0.35 };
    const swatches = themeSwatches(colors, null, picture);
    assert.equal(swatches.find((s) => s.theme === 'picture')!.picture, '/cache/sea.png');
    assert.ok(swatches.filter((s) => s.theme !== 'picture').every((s) => s.picture === null));
    assert.equal(themeSwatches(colors, null).find((s) => s.theme === 'picture')!.picture, null);
});

test("a swatch is the theme's own top and bottom colors", () => {
    const paper = themeSwatches(colors, null).find((s) => s.theme === 'paper')!;
    const palette = paletteFor('paper', colors, null);
    assert.equal(paper.top, palette.background);
    assert.equal(paper.bottom, palette.gradient ?? palette.background);
    assert.equal(paper.foreground, palette.foreground);
    const custom = themeSwatches(colors, null).find((s) => s.theme === 'custom')!;
    assert.equal(custom.top, '#203040');
});

test('aurora is tinted even without a cover, so its swatch never looks like midnight', () => {
    const swatches = themeSwatches(colors, null);
    const aurora = swatches.find((s) => s.theme === 'aurora')!;
    const midnight = swatches.find((s) => s.theme === 'midnight')!;
    assert.notEqual(aurora.top, midnight.top);
    // With a cover it takes that cover's tint.
    assert.equal(themeSwatches(colors, '#30a050').find((s) => s.theme === 'aurora')!.top, paletteFor('aurora', colors, '#30a050').background);
});
