import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    type AlertKind,
    fullscreenView,
    showsOverFullscreen,
    UnredirectHold,
} from '../src/shared/logic/fullscreen.js';

const IMPORTANT: AlertKind[] = ['battery', 'focus', 'clock', 'calendar'];
const OTHERS: AlertKind[] = ['device', 'activity', 'osd', 'download', 'memory'];

test('important_alerts_show_over_fullscreen_by_default', () => {
    for (const kind of IMPORTANT) assert.equal(showsOverFullscreen(kind, 'important'), true, kind);
    for (const kind of OTHERS) assert.equal(showsOverFullscreen(kind, 'important'), false, kind);
});

test('all_shows_every_alert_and_the_osd_over_fullscreen', () => {
    for (const kind of [...IMPORTANT, ...OTHERS]) assert.equal(showsOverFullscreen(kind, 'all'), true, kind);
});

test('none_shows_nothing_over_fullscreen', () => {
    for (const kind of [...IMPORTANT, ...OTHERS]) assert.equal(showsOverFullscreen(kind, 'none'), false, kind);
});

test('without_fullscreen_the_notch_shows_and_hover_opens_it', () => {
    assert.deepEqual(fullscreenView(false, false), { visible: true, overFullscreen: false, hover: true });
    // An alert that began over a fullscreen app changes nothing once the app leaves fullscreen.
    assert.deepEqual(fullscreenView(false, true), { visible: true, overFullscreen: false, hover: true });
});

test('fullscreen_hides_the_notch_until_an_alert_shows', () => {
    assert.deepEqual(fullscreenView(true, false), { visible: false, overFullscreen: false, hover: false });
});

test('an_alert_over_fullscreen_shows_without_hover', () => {
    assert.deepEqual(fullscreenView(true, true), { visible: true, overFullscreen: true, hover: false });
});

test('unredirect_hold_pairs_its_calls', () => {
    const calls: string[] = [];
    const hold = new UnredirectHold(
        () => calls.push('disable'),
        () => calls.push('enable'),
    );
    hold.set(false);
    assert.deepEqual(calls, []);
    hold.set(true);
    hold.set(true);
    assert.equal(hold.held, true);
    assert.deepEqual(calls, ['disable']);
    hold.set(false);
    hold.set(false);
    assert.equal(hold.held, false);
    assert.deepEqual(calls, ['disable', 'enable']);
});

test('unredirect_hold_gives_back_on_release', () => {
    const calls: string[] = [];
    const hold = new UnredirectHold(
        () => calls.push('disable'),
        () => calls.push('enable'),
    );
    hold.release();
    assert.deepEqual(calls, []);
    hold.set(true);
    hold.release();
    hold.release();
    assert.deepEqual(calls, ['disable', 'enable']);
});
