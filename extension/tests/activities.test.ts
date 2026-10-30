import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    activitiesFrom,
    activityIcon,
    endedAlert,
    formatElapsed,
    progressLabel,
} from '../src/features/activities/logic/activities.js';
import { setTranslator } from '../src/shared/logic/i18n.js';
import { chooseIndicator, INDICATOR_SLOTS, slotFor } from '../src/shared/logic/indicator.js';
import { panelHeight, subPageHeight, type PanelRow } from '../src/features/panel/logic/height.js';

test('activities are read from the daemon rows, skipping broken ones', () => {
    assert.deepEqual(
        activitiesFrom([
            ['build', 'cargo build', 'nokta-core', '', 0.25, 1_000],
            ['bad', 3, '', '', 0, 0],
            ['dl', 'Download', '', 'folder-download-symbolic', -1, 2_000],
        ]),
        [
            { id: 'build', title: 'cargo build', detail: 'nokta-core', icon: '', progress: 0.25, startedUs: 1_000 },
            { id: 'dl', title: 'Download', detail: '', icon: 'folder-download-symbolic', progress: -1, startedUs: 2_000 },
        ],
    );
    assert.deepEqual(activitiesFrom(undefined), []);
    assert.deepEqual(activitiesFrom('nope'), []);
});

test('progress shows as a whole percentage, unknown as nothing', () => {
    assert.equal(progressLabel(0.4), '40%');
    assert.equal(progressLabel(0.999), '99%');
    assert.equal(progressLabel(1), '100%');
    assert.equal(progressLabel(0), '0%');
    assert.equal(progressLabel(-1), null);
});

test('elapsed time reads like a person would say it', () => {
    assert.equal(formatElapsed(0), '0 s');
    assert.equal(formatElapsed(12_400_000), '12 s');
    assert.equal(formatElapsed(92_000_000), '1 min 32 s');
    assert.equal(formatElapsed(60_000_000), '1 min');
    assert.equal(formatElapsed(3_900_000_000), '1 h 5 min');
    assert.equal(formatElapsed(-5), '0 s');
});

test('an activity without an icon gets the default one', () => {
    assert.equal(activityIcon(''), 'emblem-synchronizing-symbolic');
    assert.equal(activityIcon('drive-harddisk-symbolic'), 'drive-harddisk-symbolic');
});

test('ended alerts say how it went', () => {
    assert.deepEqual(endedAlert('cargo build', true, '', 92_000_000), {
        icon: 'object-select-symbolic',
        title: 'cargo build',
        detail: 'Done in 1 min 32 s',
        urgent: false,
    });
    assert.deepEqual(endedAlert('Deploy', false, 'Exit code 2', 5_000_000), {
        icon: 'dialog-error-symbolic',
        title: 'Deploy',
        detail: 'Exit code 2',
        urgent: true,
    });
    assert.equal(endedAlert('Backup', true, '1204 files', 1).detail, '1204 files');
    assert.equal(endedAlert('Backup', false, '', 3_000_000).detail, 'Failed after 3 s');
});

test('a meeting countdown comes after a live activity and before the shelf', () => {
    const none = { recording: false, call: false, timer: false, clock: false, activity: false, shelf: false };
    assert.equal(chooseIndicator({ ...none, meeting: true, shelf: true }), 'meeting');
    assert.equal(chooseIndicator({ ...none, meeting: true, activity: true }), 'activity');
    assert.equal(chooseIndicator({ ...none, meeting: true, call: true }), 'call');
    assert.equal(chooseIndicator({ ...none, meeting: true }), 'meeting');
});

test('the closed notch shows a recording, else a call, else the timer, else an activity, else the shelf', () => {
    assert.equal(chooseIndicator({ recording: true, call: true, timer: true, clock: true, activity: true, shelf: true }), 'recording');
    assert.equal(chooseIndicator({ recording: false, call: true, timer: true, clock: true, activity: true, shelf: true }), 'call');
    assert.equal(chooseIndicator({ recording: false, call: false, timer: true, clock: true, activity: true, shelf: true }), 'timer');
    assert.equal(chooseIndicator({ recording: false, call: false, timer: false, clock: true, activity: true, shelf: true }), 'clock');
    assert.equal(chooseIndicator({ recording: false, call: false, timer: false, clock: false, activity: true, shelf: true }), 'activity');
    assert.equal(chooseIndicator({ recording: false, call: false, timer: false, clock: false, activity: false, shelf: true }), 'shelf');
    assert.equal(chooseIndicator({ recording: false, call: false, timer: false, clock: false, activity: false, shelf: false }), null);
});

test('home grows with its rows', () => {
    const controls: PanelRow[] = ['toggles', 'tiles'];
    assert.equal(panelHeight(32, ['date', ...controls]), 183);
    assert.equal(panelHeight(32, ['date', 'activity', ...controls]), 229);
    assert.equal(panelHeight(32, ['date', 'activity', 'activity', ...controls]), 275);
    assert.equal(panelHeight(40, ['date', ...controls]), 191);
    assert.equal(panelHeight(32, ['date', 'clock', 'clock', ...controls]), 183 + 2 * 36);
    assert.equal(panelHeight(32, ['date', 'call', ...controls]), 183 + 36);
    assert.equal(panelHeight(32, ['date', 'recording', 'call', ...controls]), 183 + 2 * 36);
    // The event row holds an icon chip, as tall as the other one-line rows.
    assert.equal(panelHeight(32, ['date', 'event', ...controls]), 183 + 36);
    // Each more event of the agenda adds a row 26 high, 2 below the one above.
    assert.equal(panelHeight(32, ['date', 'event', 'agenda', 'agenda', ...controls]), 183 + 36 + 2 * 28);
});

test('home loses the toggles or the tiles when none are chosen', () => {
    // The pills are 32 high, the tiles 59, with 12 between them.
    assert.equal(panelHeight(32, ['date', 'tiles']), 183 - 32 - 12);
    assert.equal(panelHeight(32, ['date', 'toggles']), 183 - 59 - 12);
    // Only the weekday and date, their overhang under the closed notch and the padding.
    assert.equal(panelHeight(32, ['date']), 32 + 38);
});

test('a sub-page is its padding, its header and its body', () => {
    assert.equal(subPageHeight(100), 14 + 28 + 10 + 100 + 14);
});

test('each indicator has its widget, and the focus timer and the clocks share one', () => {
    assert.equal(slotFor('recording'), 'recording');
    assert.equal(slotFor('call'), 'call');
    assert.equal(slotFor('timer'), 'timer');
    assert.equal(slotFor('clock'), 'timer');
    assert.equal(slotFor('activity'), 'badge');
    assert.equal(slotFor('meeting'), 'countdown');
    assert.equal(slotFor('shelf'), 'shelf');
    // In the order they sit over the clock.
    assert.deepEqual(INDICATOR_SLOTS, ['recording', 'call', 'timer', 'badge', 'shelf', 'countdown']);
});

test('daemon_titles_are_translated_where_they_arrive', () => {
    const words: Record<string, string> = { 'Installing updates': 'Memasang pembaruan', Downloading: 'Mengunduh' };
    setTranslator({ gettext: (s) => words[s] ?? s, ngettext: (s) => s });
    try {
        const [row] = activitiesFrom([['pk', 'Installing updates', 'Downloading', '', 0.5, 1]]);
        assert.equal(row.title, 'Memasang pembaruan');
        assert.equal(row.detail, 'Mengunduh');
        assert.equal(endedAlert('Installing updates', true, '', 0).title, 'Memasang pembaruan');
        // Text a script sent stays as it is.
        assert.equal(activitiesFrom([['b', 'cargo build', 'Compiling', '', -1, 1]])[0].title, 'cargo build');
    } finally {
        setTranslator(null);
    }
});
