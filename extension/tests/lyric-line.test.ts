import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lyricsKind, plainText, visibleLyric } from '../src/features/lyrics/logic/visible.js';
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

test('lyrics_kind_is_synced_plain_or_none', () => {
    assert.equal(lyricsKind('synced', lines, true), 'synced');
    const plain: Array<[number, string]> = [
        [0, 'one'],
        [0, ''],
        [0, 'two'],
    ];
    assert.equal(lyricsKind('plain', plain, true), 'plain');
    assert.equal(lyricsKind('plain', plain, false), null);
    assert.equal(lyricsKind('plain', [[0, ' ']], true), null);
    assert.equal(lyricsKind('synced', [], true), null);
    for (const status of ['none', 'loading', 'instrumental', 'not-found', 'error']) {
        assert.equal(lyricsKind(status, lines, true), null);
    }
});

test('plain_text_is_the_lines_one_per_row', () => {
    assert.equal(
        plainText([
            [0, 'one'],
            [0, ''],
            [0, 'two'],
        ]),
        'one\n\ntwo',
    );
});
