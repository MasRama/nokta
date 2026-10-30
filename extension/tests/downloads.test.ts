import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadButtons, downloadFrom } from '../src/features/downloads/logic/download.js';
import { DEFAULT_DOWNLOADS, downloadsFrom } from '../src/features/settings/logic/parse.js';

test('a download can be kept on the shelf only while the shelf is on', () => {
    assert.deepEqual(downloadButtons(true), ['open', 'files', 'keep']);
    assert.deepEqual(downloadButtons(false), ['open', 'files']);
});

test('the Finished signal becomes what the preview shows', () => {
    assert.deepEqual(downloadFrom(['file:///home/u/Downloads/a.pdf', 'a.pdf', 'x-office-document', 2_400_000, '']), {
        uri: 'file:///home/u/Downloads/a.pdf',
        name: 'a.pdf',
        icon: 'x-office-document',
        size: '2.4 MB',
        thumbnail: '',
    });
    // A file with an odd name still shows; a broken signal does not.
    assert.equal(downloadFrom(['file:///x', '', '', 1, ''])?.name, '');
    assert.equal(downloadFrom(['file:///x', 'x', '', 'big', '']), null);
    assert.equal(downloadFrom(['file:///x']), null);
});

test('downloads settings from table', () => {
    assert.deepEqual(DEFAULT_DOWNLOADS, { enabled: true, folder: '' });
    assert.deepEqual(downloadsFrom({ enabled: false, folder: '/data/dl' }), { enabled: false, folder: '/data/dl' });
    assert.deepEqual(downloadsFrom({ enabled: 'yes' }), DEFAULT_DOWNLOADS);
});
