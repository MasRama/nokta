import assert from 'node:assert/strict';
import { test } from 'node:test';

import { visibleLyric } from '../src/features/lyrics/logic/visible.js';
import { msUntilLine } from '../src/shared/logic/lyrics.js';

const lines: Array<[number, string]> = [
    [1_000_000, 'first'],
    [2_000_000, ''],
    [3_000_000, 'third'],
];

test('visible_lyric_is_the_current_line', () => {
    assert.equal(visibleLyric('synced', lines, true, 1_500_000), 'first');
    assert.equal(visibleLyric('synced', lines, true, 9_000_000), 'third');
});

test('gaps_and_the_intro_show_a_note', () => {
    assert.equal(visibleLyric('synced', lines, true, 500_000), '♪');
    assert.equal(visibleLyric('synced', lines, true, 2_500_000), '♪');
});

test('hidden_unless_synced_and_enabled', () => {
    assert.equal(visibleLyric('synced', lines, false, 1_500_000), null);
    for (const status of ['none', 'loading', 'plain', 'instrumental', 'not-found', 'error']) {
        assert.equal(visibleLyric(status, lines, true, 1_500_000), null);
    }
    assert.equal(visibleLyric('synced', [], true, 0), null);
});

test('ms_until_line_accounts_for_rate', () => {
    assert.equal(msUntilLine(3_000_000, 1_000_000, 1), 2000);
    assert.equal(msUntilLine(3_000_000, 1_000_000, 2), 1000);
    assert.equal(msUntilLine(3_000_000, 1_000_500, 1), 2000);
    assert.equal(msUntilLine(1_000_000, 3_000_000, 1), 0);
    assert.equal(msUntilLine(3_000_000, 1_000_000, 0), 2000);
});
