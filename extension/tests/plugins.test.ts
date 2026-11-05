import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anchorRow } from '../src/features/panel/logic/anchor.js';
import { panelHeight } from '../src/features/panel/logic/height.js';
import {
    badgeCard,
    catalogFrom,
    catalogState,
    cardsFrom,
    homeCards,
    newerVersion,
    optionText,
    PLUGIN_TONES,
    pluginAlert,
    pluginsFrom,
    statusText,
    toneColor,
} from '../src/features/plugins/logic/plugins.js';
import { alertMotion } from '../src/shared/logic/alert-motion.js';
import { showsOverFullscreen } from '../src/shared/logic/fullscreen.js';
import { chooseIndicator, slotFor } from '../src/shared/logic/indicator.js';

const INFO = JSON.stringify({
    name: 'GitHub',
    description: 'Open pull requests',
    version: '1.0.0',
    author: 'Ren',
    homepage: 'https://github.com',
    icon: 'nokta-link',
    every: 300,
    dir: '/home/ren/.local/share/nokta/plugins/github',
    runs_here: true,
    options: [
        { key: 'token', title: 'Token', subtitle: '', type: 'text', default: '', value: 'abc' },
        { key: 'count', title: 'How many', subtitle: '', type: 'int', min: 1, max: 9, default: 3, value: 5 },
        { key: 'drafts', title: 'Drafts', subtitle: '', type: 'bool', default: false, value: true },
        { key: 'sort', title: 'Sort', subtitle: '', type: 'choice', choices: ['new', 'old'], default: 'new', value: 'old' },
        { key: 'bad', title: 'Bad', type: 'int', value: 'x' },
    ],
});

test('installed plugins are read with their options, skipping broken rows', () => {
    const plugins = pluginsFrom([
        ['github', true, 'ok', '', INFO],
        ['weird', true, 'dancing', '', '{}'],
        ['short', true, 'ok'],
        ['broken', false, 'broken', 'its folder is other', 'not json'],
    ]);
    assert.equal(plugins.length, 2);
    const [github, broken] = plugins;
    assert.equal(github.name, 'GitHub');
    assert.equal(github.runsHere, true);
    assert.deepEqual(
        github.options.map((o) => [o.key, o.type, o.value]),
        [
            ['token', 'text', 'abc'],
            ['count', 'int', 5],
            ['drafts', 'bool', true],
            ['sort', 'choice', 'old'],
        ],
    );
    assert.deepEqual([github.options[1].min, github.options[1].max], [1, 9]);
    assert.deepEqual(github.options[3].choices, ['new', 'old']);
    assert.equal(broken.name, 'broken', 'the id stands in for a name');
    assert.equal(broken.message, 'its folder is other');
    assert.deepEqual(pluginsFrom(undefined), []);
});

test('cards take the plugin name and icon, and a color for their tone', () => {
    const plugins = pluginsFrom([['github', true, 'ok', '', INFO]]);
    const cards = cardsFrom(
        [
            [
                'github',
                JSON.stringify({
                    title: '3 open',
                    tone: 'blue',
                    progress: 2,
                    badge: '3',
                    items: [{ title: 'Fix', open: 'https://x' }, { detail: 'no title' }],
                    actions: [{ label: 'Open', open: 'https://github.com' }, { label: 'Nothing' }],
                }),
            ],
            ['other', JSON.stringify({ badge: '!', icon: 'nokta-bell' })],
            ['bad', 'nope'],
        ],
        plugins,
    );
    assert.equal(cards.length, 2);
    const [github, other] = cards;
    assert.equal(github.name, 'GitHub');
    assert.equal(github.icon, 'nokta-link');
    assert.equal(github.color, PLUGIN_TONES.blue);
    assert.equal(github.progress, 1);
    assert.equal(github.items.length, 1);
    assert.equal(github.actions.length, 1);
    assert.equal(other.name, 'other');
    assert.equal(other.icon, 'nokta-bell');
    assert.equal(other.progress, null);
    assert.equal(other.color, toneColor(''));
    assert.deepEqual(
        homeCards(cards).map((c) => c.id),
        ['github'],
        'a badge-only card stays in the closed notch',
    );
    assert.equal(badgeCard(cards)?.id, 'github');
    assert.equal(badgeCard([other])?.id, 'other');
    assert.equal(badgeCard([]), null);
});

test('a plugin alert falls back to the plugin icon, and red when important', () => {
    const [plugin] = pluginsFrom([['github', true, 'ok', '', INFO]]);
    assert.deepEqual(pluginAlert('Merged', '#12', '', '', false, plugin), {
        title: 'Merged',
        detail: '#12',
        icon: 'nokta-link',
        color: toneColor(''),
        important: false,
    });
    assert.equal(pluginAlert('Down', '', '', '', true, undefined).color, PLUGIN_TONES.red);
    assert.equal(pluginAlert('Down', '', '', '', true, undefined).icon, 'nokta-plugin');
    assert.equal(pluginAlert('Up', '', '', 'green', true, plugin).color, PLUGIN_TONES.green);
});

test('a plugin badge waits for a meeting and goes before the shelf', () => {
    const none = { recording: false, call: false, timer: false, clock: false, activity: false, shelf: false };
    assert.equal(chooseIndicator({ ...none, plugin: true, shelf: true }), 'plugin');
    assert.equal(chooseIndicator({ ...none, plugin: true, meeting: true }), 'meeting');
    assert.equal(chooseIndicator({ ...none, plugin: true, activity: true }), 'activity');
    assert.equal(slotFor('plugin'), 'plugin');
    assert.equal(anchorRow('plugin', ['date', 'plugin', 'toggles']), 'plugin');
    assert.equal(anchorRow('plugin', ['date', 'toggles']), null);
});

test('a plugin card in home is as tall as an activity', () => {
    assert.equal(panelHeight(32, ['date', 'plugin']), panelHeight(32, ['date', 'activity']));
});

test('only an important plugin alert shows over a fullscreen app', () => {
    assert.equal(showsOverFullscreen('plugin', 'important'), false);
    assert.equal(showsOverFullscreen('plugin-important', 'important'), true);
    assert.equal(alertMotion('plugin-important', true), 'pulse');
    assert.equal(alertMotion('plugin', true), 'kick');
});

test('the settings window says what a plugin is doing', () => {
    const [plugin] = pluginsFrom([['github', true, 'ok', '', INFO]]);
    assert.equal(statusText(plugin), 'Open pull requests');
    assert.equal(statusText({ ...plugin, status: 'error', message: 'exited with 1' }), 'Failed: exited with 1');
    assert.equal(statusText({ ...plugin, status: 'unsupported' }), 'Does not run on this system');
    assert.equal(optionText(4.6), '5');
    assert.equal(optionText(true), 'true');
});

test('the catalog is read from its JSON, and each row knows what it offers', () => {
    const catalog = catalogFrom(
        JSON.stringify([
            { id: 'github', name: 'GitHub', version: '1.1.0', runs_here: true },
            { id: 'water', name: 'Water', version: '1.0.0', runs_here: true, author: 'Nokta' },
            { id: 'mac', name: 'Mac only', version: '1.0.0', runs_here: false },
            { id: 'site', name: 'Site', version: '2.0.0', runs_here: true },
            { name: 'No id' },
            'nope',
        ]),
    );
    assert.deepEqual(catalog.map((c) => c.id), ['github', 'water', 'mac', 'site']);
    assert.equal(catalog[1].author, 'Nokta');
    assert.deepEqual(catalogFrom('not json'), []);
    assert.deepEqual(catalogFrom('{}'), []);

    // GitHub 1.0.0 is installed.
    const installed = pluginsFrom([['github', true, 'ok', '', INFO]]);
    assert.deepEqual(
        catalog.map((c) => catalogState(c, installed)),
        ['update', 'install', 'unsupported', 'install'],
    );
    assert.equal(catalogState({ ...catalog[0], version: '1.0.0' }, installed), 'installed');
});

test('a version is newer by its numbers, one by one', () => {
    assert.ok(newerVersion('1.0.0', '1.0.1'));
    assert.ok(newerVersion('1.9', '1.10'));
    assert.ok(newerVersion('v1.0', '2'));
    assert.ok(!newerVersion('1.0.0', '1.0'));
    assert.ok(!newerVersion('1.2.0', '1.1.9'));
    assert.ok(!newerVersion('1.0.0', '1.0.0-beta'));
});
