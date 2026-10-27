import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    DEFAULT_APPEARANCE,
    DEFAULT_BEHAVIOR,
    DEFAULT_LYRICS,
    DEFAULT_NOTIFICATIONS,
    DEFAULT_TIMER,
} from '../src/features/settings/logic/parse.js';
import { allRows, rowValue, SETTINGS_PAGES, variantType } from '../src/features/settings/logic/schema.js';

const camel = (key: string): string => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const DEFAULTS: Record<string, Record<string, unknown>> = {
    appearance: { ...DEFAULT_APPEARANCE },
    behavior: { ...DEFAULT_BEHAVIOR },
    lyrics: { ...DEFAULT_LYRICS },
    timer: { ...DEFAULT_TIMER },
    notifications: { ...DEFAULT_NOTIFICATIONS },
};

test('every_setting_has_exactly_one_row', () => {
    const fromSchema = allRows().map((r) => `${r.table}.${camel(r.key)}`).sort();
    const fromDefaults = Object.entries(DEFAULTS)
        .flatMap(([table, values]) => Object.keys(values).map((key) => `${table}.${key}`))
        .sort();
    assert.deepEqual(fromSchema, fromDefaults);
});

test('row_kinds_match_their_defaults', () => {
    for (const row of allRows()) {
        const value = DEFAULTS[row.table][camel(row.key)];
        const name = `${row.table}.${row.key}`;
        switch (row.kind.type) {
            case 'bool':
                assert.equal(typeof value, 'boolean', name);
                break;
            case 'int':
            case 'float':
                assert.equal(typeof value, 'number', name);
                assert.ok((value as number) >= row.kind.min && (value as number) <= row.kind.max, name);
                break;
            case 'color':
                assert.match(value as string, /^#[0-9a-f]{6}$/i, name);
                break;
            case 'choice':
                assert.ok(row.kind.options.some((o) => o.value === value), name);
                break;
            case 'text':
                assert.equal(typeof value, 'string', name);
                break;
        }
    }
});

test('pages_have_titles_and_groups', () => {
    assert.deepEqual(
        SETTINGS_PAGES.map((p) => p.name),
        ['appearance', 'behavior'],
    );
    for (const page of SETTINGS_PAGES) {
        assert.ok(page.title && page.icon && page.groups.length > 0, page.name);
        for (const group of page.groups) assert.ok(group.rows.length > 0, group.title);
    }
});

test('variant_types_follow_the_daemon', () => {
    const type = (table: string, key: string) => {
        const row = allRows().find((r) => r.table === table && r.key === key);
        assert.ok(row, `${table}.${key}`);
        return variantType(row.kind);
    };
    assert.equal(type('appearance', 'height'), 'u');
    assert.equal(type('appearance', 'animation_speed'), 'd');
    assert.equal(type('appearance', 'background_opacity'), 'd');
    assert.equal(type('appearance', 'background'), 's');
    assert.equal(type('behavior', 'clock_format'), 's');
    assert.equal(type('lyrics', 'enabled'), 'b');
    assert.equal(type('timer', 'shortcut'), 's');
});

test('row_value_reads_the_daemon_tables', () => {
    const row = (key: string) => allRows().find((r) => r.key === key)!;
    const tables = { appearance: { idle_width: 200, background: 'black' }, behavior: { clock_format: '24h' } };
    assert.equal(rowValue(row('idle_width'), tables), 200);
    assert.equal(rowValue(row('clock_format'), tables), '24h');
    // A wrong or missing value shows the default.
    assert.equal(rowValue(row('background'), tables), '#000000');
    assert.equal(rowValue(row('enabled'), tables), true);
    assert.equal(rowValue(row('height'), {}), 32);
});
