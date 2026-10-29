import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { NOKTA_ICONS } from '../src/shared/logic/icon-names.js';
import { SETTINGS_PAGES } from '../src/features/settings/logic/schema.js';
import { BRAND_LOGO, brandCss, EMBER, PREFS_CLASS, PREFS_CSS } from '../src/prefs/logic/style.js';
import { gradientEnds, pageIcon, previewModel, SAMPLE_SONG } from '../src/prefs/logic/look.js';
import { paletteFor } from '../src/shared/logic/theme.js';
import { themeSwatches } from '../src/features/settings/logic/quick.js';

/** Every selector of every rule, comments taken out. */
function selectors(css: string): string[] {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('}')
        .map((rule) => rule.split('{')[0].trim())
        .filter((head) => head !== '')
        .flatMap((head) => head.split(',').map((selector) => selector.trim()));
}

test("every rule of the window's stylesheet is scoped to Nokta's window", () => {
    const all = selectors(PREFS_CSS);
    assert.ok(all.length > 20);
    const loose = all.filter((selector) => selector !== `.${PREFS_CLASS}` && !selector.startsWith(`.${PREFS_CLASS} `));
    assert.deepEqual(loose, []);
});

test('the stylesheet works on GTK 4.14: no CSS variables, no named colors', () => {
    assert.equal(/var\(|@define-color|@[a-z_]+/.test(PREFS_CSS), false);
});

test('the accent is ember', () => {
    assert.equal(EMBER, '#ff6a3d');
    assert.ok(PREFS_CSS.includes(EMBER));
});

test("the sidebar's logo is the light wordmark from icons/, drawn at its own proportions", () => {
    // Run from .test-build/tests: the icons are at the extension's root.
    assert.ok(existsSync(new URL(`../../icons/${BRAND_LOGO}`, import.meta.url)), `icons/${BRAND_LOGO} is missing`);
    const css = brandCss('file:///ext/icons/nokta-wordmark-reverse.svg');
    assert.ok(css.includes('url("file:///ext/icons/nokta-wordmark-reverse.svg")'));
    assert.ok(selectors(css).every((selector) => selector.startsWith(`.${PREFS_CLASS} `)));
    const width = Number(/min-width: (\d+)px/.exec(css)?.[1]);
    const height = Number(/min-height: (\d+)px/.exec(css)?.[1]);
    // The wordmark's viewBox is 900.67 x 200.
    assert.ok(Math.abs(width / height - 900.67 / 200) < 0.05, `${width} x ${height}`);
});

test("each page of the sidebar has one of Nokta's icons", () => {
    for (const page of SETTINGS_PAGES) {
        const icon = pageIcon(page.name);
        assert.ok(icon && (NOKTA_ICONS as readonly string[]).includes(icon), page.name);
    }
    assert.equal(pageIcon('appearance'), 'dark-style');
    assert.equal(pageIcon('behavior'), 'settings');
    assert.equal(pageIcon('home'), 'home');
});

const appearance = {
    theme: 'graphite',
    background: '#000000',
    backgroundOpacity: 1,
    foreground: '#ffffff',
    accent: '#ffffff',
    useAlbumAccent: false,
    progressLine: true,
    cornerRadius: 22,
    earRadius: 10,
};

test("the preview draws the chosen theme's palette with the sample song's cover", () => {
    const model = previewModel(appearance);
    assert.deepEqual(model.palette, paletteFor('graphite', appearance, SAMPLE_SONG.cover));
    assert.equal(model.title, SAMPLE_SONG.title);
    assert.equal(model.artist, SAMPLE_SONG.artist);
});

test("the preview's accent follows the cover only while that setting is on", () => {
    assert.equal(previewModel(appearance).palette.accent, '#e5e5ea');
    assert.equal(previewModel({ ...appearance, useAlbumAccent: true }).palette.accent, SAMPLE_SONG.cover);
});

test("with the cover behind the player, the preview shows the sample cover's color under white text", () => {
    const model = previewModel({ ...appearance, theme: 'paper', coverBackdrop: true });
    assert.equal(model.palette.foreground, '#ffffff');
    assert.equal(model.palette.light, false);
    assert.equal(model.palette.picture, null);
    assert.notEqual(model.palette.background, paletteFor('paper', appearance, SAMPLE_SONG.cover).background);
});

test('the progress line shows only while it is on', () => {
    assert.equal(previewModel(appearance).progress, SAMPLE_SONG.position);
    assert.equal(previewModel({ ...appearance, progressLine: false }).progress, null);
});

test("the preview's corners follow the shape settings, kept to what its size can draw", () => {
    assert.deepEqual([previewModel(appearance).cornerRadius, previewModel(appearance).earRadius], [22, 10]);
    const big = previewModel({ ...appearance, cornerRadius: 64, earRadius: 64 });
    assert.deepEqual([big.cornerRadius, big.earRadius], [28, 16]);
    const none = previewModel({ ...appearance, cornerRadius: 0, earRadius: 0 });
    assert.deepEqual([none.cornerRadius, none.earRadius], [0, 0]);
});

test("the preview's gradient runs the way the notch's shader runs it", () => {
    assert.deepEqual(gradientEnds(10, 200, 100, [0, 1]), [10, 0, 10, 100]);
    assert.deepEqual(gradientEnds(10, 200, 100, [1, 0]), [10, 0, 210, 0]);
    // Corner to corner on a square body; the lines of one color are the
    // anti-diagonals of the body whatever its shape.
    const [x0, y0, x1, y1] = gradientEnds(0, 100, 100, [Math.SQRT1_2, Math.SQRT1_2]);
    assert.deepEqual([x0, y0], [0, 0]);
    assert.ok(Math.abs(x1 - 100) < 1e-9 && Math.abs(y1 - 100) < 1e-9);
    const [, , wx, wy] = gradientEnds(0, 400, 100, [Math.SQRT1_2, Math.SQRT1_2]);
    // At (400, 0) and (0, 100) the shader is halfway: both project to t = 0.5.
    const t = (px: number, py: number) => (px * wx + py * wy) / (wx * wx + wy * wy);
    assert.ok(Math.abs(t(400, 0) - 0.5) < 1e-9 && Math.abs(t(0, 100) - 0.5) < 1e-9);
});

test('the swatches carry the direction of the custom gradient', () => {
    const swatch = themeSwatches({ ...appearance, gradient: 'across', backgroundEnd: '#ff0000' }, null).find(
        (s) => s.theme === 'custom',
    );
    assert.deepEqual([swatch?.bottom, swatch?.direction], ['#ff0000', [1, 0]]);
});
