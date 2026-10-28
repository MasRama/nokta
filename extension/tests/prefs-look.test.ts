import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NOKTA_ICONS } from '../src/shared/logic/icon-names.js';
import { SETTINGS_PAGES } from '../src/features/settings/logic/schema.js';
import { EMBER, PREFS_CLASS, PREFS_CSS } from '../src/prefs/logic/style.js';
import { pageIcon, previewModel, SAMPLE_SONG } from '../src/prefs/logic/look.js';
import { paletteFor } from '../src/shared/logic/theme.js';

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
