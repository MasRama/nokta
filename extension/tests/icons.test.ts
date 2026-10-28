import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { NOKTA_ICONS, noktaIconName } from '../src/shared/logic/icon-names.js';

test("GNOME's media, OSD and chrome icons have a Nokta one", () => {
    assert.equal(noktaIconName('media-playback-start-symbolic'), 'play');
    assert.equal(noktaIconName('media-skip-forward-symbolic'), 'next');
    assert.equal(noktaIconName('media-playlist-repeat-song-symbolic'), 'repeat-one');
    assert.equal(noktaIconName('audio-volume-muted-symbolic'), 'volume-0');
    assert.equal(noktaIconName('audio-volume-overamplified-symbolic'), 'volume-3');
    assert.equal(noktaIconName('display-brightness-symbolic'), 'brightness');
    assert.equal(noktaIconName('microphone-sensitivity-medium-symbolic'), 'mic');
    assert.equal(noktaIconName('view-app-grid-symbolic'), 'home');
});

test('a name without -symbolic maps too, so a fallback name in a list still finds one', () => {
    assert.equal(noktaIconName('audio-volume-high'), 'volume-3');
});

test("Nokta's own names are taken as they are", () => {
    assert.equal(noktaIconName('nokta-focus'), 'focus');
    assert.equal(noktaIconName('nokta-caffeine-symbolic'), 'caffeine');
    assert.equal(noktaIconName('nokta-nothing'), null);
});

test("content icons (weather, files, apps) stay the system's", () => {
    assert.equal(noktaIconName('weather-clear-symbolic'), null);
    assert.equal(noktaIconName('folder-documents-symbolic'), null);
    assert.equal(noktaIconName('org.gnome.Nautilus'), null);
});

test('every Nokta icon has its file in icons/', () => {
    for (const name of NOKTA_ICONS) {
        // Run from .test-build/tests: the icons are at the extension's root.
        const file = new URL(`../../icons/nokta-${name}-symbolic.svg`, import.meta.url);
        assert.ok(existsSync(file), `icons/nokta-${name}-symbolic.svg is missing`);
    }
});
