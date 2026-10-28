import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    activitiesFrom,
    activityIcon,
    endedAlert,
    formatElapsed,
    progressLabel,
} from '../src/features/activities/logic/activities.js';
import { chooseIndicator } from '../src/shared/logic/indicator.js';
import { panelHeight } from '../src/features/panel/logic/height.js';

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

test('the closed notch shows the timer, else an activity, else the shelf', () => {
    assert.equal(chooseIndicator({ timer: true, activity: true, shelf: true }), 'timer');
    assert.equal(chooseIndicator({ timer: false, activity: true, shelf: true }), 'activity');
    assert.equal(chooseIndicator({ timer: false, activity: false, shelf: true }), 'shelf');
    assert.equal(chooseIndicator({ timer: false, activity: false, shelf: false }), null);
});

test('the idle panel grows with its rows', () => {
    assert.equal(panelHeight(32, ['date', 'buttons']), 90);
    assert.equal(panelHeight(32, ['date', 'activity', 'buttons']), 136);
    assert.equal(panelHeight(32, ['date', 'activity', 'activity', 'buttons']), 182);
    assert.equal(panelHeight(40, ['date', 'buttons']), 98);
});
