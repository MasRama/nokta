import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { DAEMON_STRINGS } from '../src/shared/logic/daemon-strings.js';
import { _, format, N_, ngettext, setTranslator } from '../src/shared/logic/i18n.js';

afterEach(() => setTranslator(null));

test('english_without_a_translator', () => {
    assert.equal(_('Open'), 'Open');
    assert.equal(N_('Show in Files'), 'Show in Files');
    assert.equal(ngettext('%d file', '%d files', 1), '%d file');
    assert.equal(ngettext('%d file', '%d files', 0), '%d files');
    assert.equal(ngettext('%d file', '%d files', 2), '%d files');
});

test('the_translator_is_used_once_set', () => {
    setTranslator({
        gettext: (s) => (s === 'Open' ? 'Buka' : s),
        ngettext: (_s, _p, n) => `${n} berkas`,
    });
    assert.equal(_('Open'), 'Buka');
    assert.equal(_('Unknown'), 'Unknown');
    assert.equal(ngettext('%d file', '%d files', 3), '3 berkas');
    // N_ only marks a string; it is translated where it is drawn.
    assert.equal(N_('Open'), 'Open');
    setTranslator(null);
    assert.equal(_('Open'), 'Open');
});

test('an_empty_string_stays_empty', () => {
    // gettext answers '' with the catalog's header.
    setTranslator({ gettext: () => 'Project-Id-Version: nokta', ngettext: (s) => s });
    assert.equal(_(''), '');
});

test('format_fills_in_order', () => {
    assert.equal(format('%s of %d', 'a', 3), 'a of 3');
    assert.equal(format('%s uses %s', 'Firefox', '6.2 GB'), 'Firefox uses 6.2 GB');
    assert.equal(format('100%%'), '100%');
    assert.equal(format('%s%%', 40), '40%');
    // Missing values leave nothing behind; extra values are ignored.
    assert.equal(format('%s and %s', 'a'), 'a and ');
    assert.equal(format('only', 'x'), 'only');
});

function extract(source: string): { ok: boolean; output: string } {
    const dir = mkdtempSync(join(tmpdir(), 'nokta-i18n-'));
    writeFileSync(join(dir, 'sample.ts'), source);
    try {
        return { ok: true, output: execFileSync('node', ['scripts/i18n.mjs', '--extract', dir], { encoding: 'utf8' }) };
    } catch (error) {
        const failed = error as { stdout?: string; stderr?: string };
        return { ok: false, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
    }
}

test('the_extractor_finds_every_kind_of_call', () => {
    const { ok, output } = extract(
        [
            "const a = _('Open');",
            'const b = N_("Show in Files");',
            'const c = _(`Keep on shelf`);',
            "const d = ngettext('%d file', '%d files', n);",
            "const e = _('It\\'s here');",
        ].join('\n'),
    );
    assert.ok(ok, output);
    const found = JSON.parse(output) as { msgid: string; plural?: string }[];
    assert.deepEqual(
        found.map((entry) => [entry.msgid, entry.plural ?? null]),
        [
            ['Open', null],
            ['Show in Files', null],
            ['Keep on shelf', null],
            ['%d file', '%d files'],
            ["It's here", null],
        ],
    );
});

test('the_extractor_rejects_a_runtime_argument_unless_marked', () => {
    assert.equal(extract('const a = _(title);').ok, false);
    assert.equal(extract('const a = _(`Hi ${name}`);').ok, false);
    assert.ok(extract('const a = _(title); // i18n: runtime').ok);
    // Words that only end in an underscore are not calls.
    assert.ok(extract('const a = this.foo_(title); const b = make_(x);').ok);
    // Nor is an underscore in a regular expression.
    assert.ok(extract("const c = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());").ok);
});

test('every_text_the_daemon_shows_is_listed_for_translation', () => {
    const core = join(import.meta.dirname, '..', '..', '..', 'core', 'src', 'features', 'activities');
    const body = (file: string, name: string): string => {
        const source = readFileSync(join(core, file), 'utf8');
        return source.slice(source.indexOf(`fn ${name}(`)).split('\n}')[0];
    };
    const shown = [body('packagekit.rs', 'title'), body('packagekit.rs', 'detail'), body('launcher.rs', 'detail_for')]
        .flatMap((code) => [...code.matchAll(/"([A-Z][a-z][^"]*)"/g)])
        .map((m) => m[1]);
    const update = readFileSync(join(core, '..', '..', 'cli', 'update.rs'), 'utf8');
    shown.push(...[...update.matchAll(/(?:TITLE: &str = |say\()"([^"]+)"/g)].map((m) => m[1]));
    assert.ok(shown.length >= 22, `found only ${shown.length}`);
    for (const text of shown) assert.ok(DAEMON_STRINGS.includes(text), `${text} is not in daemon-strings.ts`);
});
