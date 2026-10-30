import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    drawnView,
    type OverlayState,
    resizeKind,
    showsAlert,
    TOUR_EXTRA_HEIGHT,
    viewSize,
    type SizeInput,
} from '../src/logic/views.js';

const calm: OverlayState = {
    dropping: false,
    osd: false,
    notification: null,
    mode: 'expanded',
    peek: false,
    page: false,
    homeOpen: false,
    player: true,
    tour: false,
};

test('the drop area goes over the OSD, over a notification, over the mode', () => {
    assert.equal(drawnView({ ...calm, dropping: true, osd: true, notification: 'notification' }), 'drop');
    assert.equal(drawnView({ ...calm, osd: true, notification: 'notification' }), 'osd');
    assert.equal(drawnView({ ...calm, notification: 'screenshot' }), 'screenshot');
    assert.equal(drawnView({ ...calm, notification: 'download' }), 'download');
    assert.equal(drawnView(calm), 'expanded');
});

test('the tour goes over home and the player; an alert still shows over it', () => {
    assert.equal(drawnView({ ...calm, tour: true, homeOpen: true, page: true }), 'tour');
    assert.equal(drawnView({ ...calm, tour: true, player: false }), 'tour');
    assert.equal(drawnView({ ...calm, tour: true, osd: true }), 'osd');
    assert.equal(drawnView({ ...calm, tour: true, notification: 'download' }), 'download');
});

test('a new song peeks only from the closed player', () => {
    assert.equal(drawnView({ ...calm, mode: 'collapsed', peek: true }), 'peek');
    assert.equal(drawnView({ ...calm, mode: 'idle', peek: true }), 'idle');
    assert.equal(drawnView({ ...calm, mode: 'collapsed' }), 'collapsed');
});

test('open, a page goes over home, and home shows without a player or when asked', () => {
    assert.equal(drawnView({ ...calm, page: true, homeOpen: true }), 'page');
    assert.equal(drawnView({ ...calm, homeOpen: true }), 'panel');
    assert.equal(drawnView({ ...calm, player: false }), 'panel');
    // Closed, neither a page nor home shows.
    assert.equal(drawnView({ ...calm, mode: 'idle', page: true, homeOpen: true }), 'idle');
});

test('the notch opens into a tall view, closes out of one, and else only changes width', () => {
    assert.equal(resizeKind('idle', 'expanded'), 'open');
    assert.equal(resizeKind('panel', 'notification'), 'open');
    assert.equal(resizeKind('idle', 'download'), 'open');
    assert.equal(resizeKind('idle', 'tour'), 'open');
    assert.equal(resizeKind('tour', 'idle'), 'close');
    assert.equal(resizeKind('expanded', 'collapsed'), 'close');
    assert.equal(resizeKind('drop', 'idle'), 'close');
    assert.equal(resizeKind('idle', 'osd'), 'width');
    assert.equal(resizeKind('collapsed', 'peek'), 'width');
});

test('only the OSD, a notification, a screenshot and a download keep the alert glow', () => {
    const views = ['idle', 'collapsed', 'peek', 'expanded', 'panel', 'page', 'osd', 'notification', 'screenshot', 'download', 'drop', 'tour'] as const;
    assert.deepEqual(views.filter(showsAlert), ['osd', 'notification', 'screenshot', 'download']);
});

const sizes: SizeInput = {
    appearance: { height: 32, idleWidth: 180, playingWidth: 260, expandedWidth: 420, expandedHeight: 150, osdWidth: 300 },
    notificationButtons: false,
    panelHeight: 240,
    pageHeight: 300,
    expandedExtra: 40,
};

test('each view has its own size', () => {
    assert.deepEqual(viewSize('idle', sizes), [180, 32]);
    assert.deepEqual(viewSize('collapsed', sizes), [260, 32]);
    assert.deepEqual(viewSize('peek', sizes), [420, 32]);
    assert.deepEqual(viewSize('osd', sizes), [300, 32]);
    assert.deepEqual(viewSize('expanded', sizes), [420, 190]);
    assert.deepEqual(viewSize('panel', sizes), [420, 240]);
    assert.deepEqual(viewSize('page', sizes), [420, 300]);
    assert.deepEqual(viewSize('notification', sizes), [420, 60]);
    assert.deepEqual(viewSize('screenshot', sizes), [420, 116]);
    // A download has a line for its size under the name.
    assert.deepEqual(viewSize('download', sizes), [420, 134]);
    assert.deepEqual(viewSize('drop', sizes), [420, 108]);
    assert.deepEqual(viewSize('tour', sizes), [420, 32 + TOUR_EXTRA_HEIGHT]);
});

test('a notification grows by its row of buttons', () => {
    assert.deepEqual(viewSize('notification', { ...sizes, notificationButtons: true }), [420, 92]);
});
