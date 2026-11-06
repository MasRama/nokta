import assert from 'node:assert/strict';
import { test } from 'node:test';

import { versionDetail, versionsFrom } from '../src/features/lyrics/logic/versions.js';

test('search_rows_become_versions_and_bad_rows_are_left_out', () => {
    const rows = [
        [7, 'Sial', 'Mahalini', 'Fabula', 244_000, true],
        [8, 'Sial', 'Someone', '', 0, false],
        [9, 'Broken', 'Row'],
        'not a row',
    ];
    assert.deepEqual(versionsFrom(rows), [
        { id: 7, title: 'Sial', artist: 'Mahalini', album: 'Fabula', durationMs: 244_000, synced: true },
        { id: 8, title: 'Sial', artist: 'Someone', album: '', durationMs: 0, synced: false },
    ]);
    assert.deepEqual(versionsFrom(null), []);
});

test('a_version_says_who_sings_it_how_long_it_is_and_whether_it_has_timing', () => {
    const version = { id: 7, title: 'Sial', artist: 'Mahalini', album: '', durationMs: 244_400, synced: true };
    assert.equal(versionDetail(version), 'Mahalini · 4:04 · Synced');
    assert.equal(versionDetail({ ...version, durationMs: 0, synced: false }), 'Mahalini · No timing');
    assert.equal(versionDetail({ ...version, artist: '', synced: false }), '4:04 · No timing');
});
