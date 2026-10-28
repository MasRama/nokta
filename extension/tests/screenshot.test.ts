import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    FILE_PAIR_MS,
    isScreenshotBanner,
    screenshotButtons,
    ScreenshotFiles,
} from '../src/features/notifications/logic/screenshot.js';

test('a screenshot banner comes from GNOME screenshot source with an image', () => {
    // GNOME 46 to 48, then 49 and later.
    assert.equal(isScreenshotBanner({ sourceIcon: 'screenshot-recorded-symbolic', hasImage: true }), true);
    assert.equal(isScreenshotBanner({ sourceIcon: 'screenshooter-symbolic', hasImage: true }), true);
    // A screencast comes from the same source, without an image.
    assert.equal(isScreenshotBanner({ sourceIcon: 'screenshooter-symbolic', hasImage: false }), false);
    assert.equal(isScreenshotBanner({ sourceIcon: 'org.gnome.Nautilus', hasImage: true }), false);
    assert.equal(isScreenshotBanner({ sourceIcon: null, hasImage: true }), false);
});

test('the preview offers what it can do', () => {
    assert.deepEqual(screenshotButtons({ saved: true, file: true, shelf: true }), ['open', 'files', 'keep']);
    // A direct shortcut does not say which file it saved.
    assert.deepEqual(screenshotButtons({ saved: true, file: false, shelf: true }), ['open', 'files']);
    assert.deepEqual(screenshotButtons({ saved: true, file: true, shelf: false }), ['open', 'files']);
    // Saving to disk can be turned off: the image is only on the clipboard.
    assert.deepEqual(screenshotButtons({ saved: false, file: false, shelf: true }), []);
});

test('a file saved just before the preview belongs to it, once', () => {
    const files = new ScreenshotFiles();
    assert.equal(files.saved('file:///s/a.png', 1000), false);
    assert.equal(files.previewed(1000 + FILE_PAIR_MS), 'file:///s/a.png');
    files.ended();
    assert.equal(files.previewed(1500 + FILE_PAIR_MS), null);
});

test('a file saved just after the preview opened goes to it', () => {
    const files = new ScreenshotFiles();
    assert.equal(files.previewed(1000), null);
    assert.equal(files.saved('file:///s/a.png', 1010), true);
    // Only one file per preview.
    assert.equal(files.saved('file:///s/b.png', 1020), false);
});

test('a file saved while another preview closes waits for its own', () => {
    const files = new ScreenshotFiles();
    files.previewed(1000);
    files.saved('file:///s/a.png', 9000);
    files.ended();
    assert.equal(files.previewed(9100), 'file:///s/a.png');
});

test('a preview stops waiting for its file after a while', () => {
    const files = new ScreenshotFiles();
    files.previewed(1000);
    assert.equal(files.saved('file:///s/a.png', 1001 + FILE_PAIR_MS), false);
});

test('an old file or a closed preview is not paired', () => {
    const files = new ScreenshotFiles();
    files.saved('file:///s/a.png', 1000);
    assert.equal(files.previewed(1001 + FILE_PAIR_MS), null);
    files.ended();
    assert.equal(files.previewed(5000), null);
    files.ended();
    // The preview is gone when the file arrives.
    assert.equal(files.saved('file:///s/b.png', 6000), false);
    assert.equal(files.previewed(6001), 'file:///s/b.png');
    files.ended();
    assert.equal(files.previewed(2 * FILE_PAIR_MS + 6001), null);
});
