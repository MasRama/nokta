import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    DEFAULT_ACTIVITIES,
    DEFAULT_APPEARANCE,
    DEFAULT_BEHAVIOR,
    DEFAULT_LYRICS,
    DEFAULT_MEDIA,
    DEFAULT_NOTIFICATIONS,
    DEFAULT_CALENDAR,
    DEFAULT_CLIPBOARD,
    DEFAULT_DOWNLOADS,
    DEFAULT_SYSTEM,
    DEFAULT_HOME,
    DEFAULT_TIMER,
    DEFAULT_WEATHER,
} from '../src/features/settings/logic/parse.js';
import { allRows, rowMin, rowValue, SETTINGS_PAGES, variantType } from '../src/features/settings/logic/schema.js';

const camel = (key: string): string => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const DEFAULTS: Record<string, Record<string, unknown>> = {
    appearance: { ...DEFAULT_APPEARANCE },
    behavior: { ...DEFAULT_BEHAVIOR },
    media: { ...DEFAULT_MEDIA },
    lyrics: { ...DEFAULT_LYRICS },
    timer: { ...DEFAULT_TIMER },
    notifications: { ...DEFAULT_NOTIFICATIONS },
    activities: { ...DEFAULT_ACTIVITIES },
    weather: { ...DEFAULT_WEATHER },
    calendar: { ...DEFAULT_CALENDAR },
    clipboard: { ...DEFAULT_CLIPBOARD },
    downloads: { ...DEFAULT_DOWNLOADS },
    system: { ...DEFAULT_SYSTEM },
    home: { ...DEFAULT_HOME },
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
            case 'file':
                assert.equal(typeof value, 'string', name);
                break;
            case 'order': {
                const { options, max } = row.kind;
                assert.ok(Array.isArray(value) && value.length <= max, name);
                for (const item of value as string[]) assert.ok(options.some((o) => o.value === item), name);
                break;
            }
        }
    }
});

test('the picture is chosen as an image file, and every theme can be picked', () => {
    const rows = allRows();
    assert.equal(rows.find((r) => r.key === 'picture')!.kind.type, 'file');
    const theme = rows.find((r) => r.key === 'theme')!.kind;
    assert.ok(theme.type === 'choice' && theme.options.some((o) => o.value === 'picture'));
});

test('pages_have_titles_and_groups', () => {
    assert.deepEqual(
        SETTINGS_PAGES.map((p) => p.name),
        ['appearance', 'behavior', 'home'],
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
    assert.equal(type('behavior', 'fullscreen_alerts'), 's');
    assert.equal(type('behavior', 'open_on'), 's');
    assert.equal(type('behavior', 'open_shortcut'), 's');
    assert.equal(type('lyrics', 'enabled'), 'b');
    assert.equal(type('media', 'real_equalizer'), 'b');
    assert.equal(type('timer', 'shortcut'), 's');
    assert.equal(type('home', 'tiles'), 'as');
});

test('fullscreen_alerts_offers_the_daemons_three_values', () => {
    const row = allRows().find((r) => r.key === 'fullscreen_alerts');
    assert.ok(row?.kind.type === 'choice');
    assert.deepEqual(
        row.kind.options.map((o) => o.value),
        ['important', 'all', 'none'],
    );
});

test('open_on_offers_hover_and_click_and_the_shortcut_is_text', () => {
    const row = allRows().find((r) => r.key === 'open_on');
    assert.ok(row?.kind.type === 'choice');
    assert.deepEqual(
        row.kind.options.map((o) => o.value),
        ['hover', 'click'],
    );
    assert.equal(allRows().find((r) => r.key === 'open_shortcut')?.kind.type, 'text');
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

test('a width cannot go below the height, as the daemon checks', () => {
    const row = (key: string) => allRows().find((r) => r.table === 'appearance' && r.key === key)!;
    const tables = { appearance: { height: 40 } };
    for (const key of ['idle_width', 'playing_width', 'expanded_width', 'expanded_height', 'osd_width'])
        assert.equal(rowMin(row(key), tables), 40, key);
    assert.equal(rowMin(row('height'), tables), 16);
    // Before the daemon answers, the floor is the default height.
    assert.equal(rowMin(row('idle_width'), {}), DEFAULT_APPEARANCE.height);
});
