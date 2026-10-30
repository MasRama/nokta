import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
    DEFAULT_ACTIVITIES,
    DEFAULT_APPEARANCE,
    DEFAULT_BEHAVIOR,
    DEFAULT_CALENDAR,
    DEFAULT_CLIPBOARD,
    DEFAULT_HOME,
    DEFAULT_LYRICS,
    DEFAULT_MEDIA,
    DEFAULT_NOTIFICATIONS,
    DEFAULT_TIMER,
    DEFAULT_WEATHER,
} from '../src/features/settings/logic/parse.js';
import { allRows } from '../src/features/settings/logic/schema.js';

// The daemon owns config.toml: its defaults and the bounds it checks. The
// extension keeps its own copy of both, for before the daemon answers and
// for the settings window's rows. These tests read the daemon's sources so
// the two copies cannot drift apart.
const SETTINGS = resolve(process.cwd(), '../core/src/features/settings');

const camel = (key: string) => key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

/** The line up to a `#` that is not inside a string. */
function withoutComment(line: string): string {
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && line[i - 1] !== '\\') quoted = !quoted;
        else if (line[i] === '#' && !quoted) return line.slice(0, i);
    }
    return line;
}

/** The subset of TOML that default_config.toml uses: tables, and keys with a string, number, bool or string array. */
function parseDefaults(text: string): Record<string, Record<string, unknown>> {
    const tables: Record<string, Record<string, unknown>> = {};
    let table: Record<string, unknown> | null = null;
    for (const raw of text.split('\n')) {
        const line = withoutComment(raw).trim();
        if (line === '' || line.startsWith('#')) continue;
        const header = /^\[([a-z_]+)\]$/.exec(line);
        if (header) {
            table = tables[header[1]] = {};
            continue;
        }
        const pair = /^([a-z_]+)\s*=\s*(.+)$/.exec(line);
        assert.ok(pair && table, `cannot read the line ${JSON.stringify(raw)}`);
        table[pair[1]] = JSON.parse(pair[2]);
    }
    return tables;
}

const EXTENSION_DEFAULTS: Record<string, object> = {
    appearance: DEFAULT_APPEARANCE,
    behavior: DEFAULT_BEHAVIOR,
    media: DEFAULT_MEDIA,
    lyrics: DEFAULT_LYRICS,
    timer: DEFAULT_TIMER,
    notifications: DEFAULT_NOTIFICATIONS,
    activities: DEFAULT_ACTIVITIES,
    weather: DEFAULT_WEATHER,
    calendar: DEFAULT_CALENDAR,
    clipboard: DEFAULT_CLIPBOARD,
    home: DEFAULT_HOME,
};

test("the extension's defaults are the daemon's default config", () => {
    const daemon = parseDefaults(readFileSync(`${SETTINGS}/default_config.toml`, 'utf8'));
    const fromDaemon = Object.fromEntries(
        Object.entries(daemon).map(([table, values]) => [
            table,
            Object.fromEntries(Object.entries(values).map(([key, value]) => [camel(key), value])),
        ]),
    );
    assert.deepEqual(fromDaemon, JSON.parse(JSON.stringify(EXTENSION_DEFAULTS)));
});

/** A bound the daemon checks: a number, or another key of the same table. */
type Bound = number | { key: string };

/** Every `check_range` and `check_float` in config.rs, by `table.key`. */
function daemonBounds(): Map<string, [Bound, Bound]> {
    const source = readFileSync(`${SETTINGS}/config.rs`, 'utf8');
    const bound = (text: string): Bound => {
        const number = Number(text.trim());
        if (!Number.isNaN(number)) return number;
        const field = /^[a-z]+\.([a-z_]+)$/.exec(text.trim());
        assert.ok(field, `cannot read the bound ${text}`);
        return { key: field[1] };
    };
    const found = new Map<string, [Bound, Bound]>();
    for (const m of source.matchAll(/check_(?:range|float)\(\s*"([a-z_.]+)",\s*[^,]+,\s*([^,]+),\s*([^,)]+),?\s*\)/g))
        found.set(m[1], [bound(m[2]), bound(m[3])]);
    // `for (key, width) in [("appearance.idle_width", ...), ...] { check_range(key, width, min, max)?; }`
    for (const m of source.matchAll(/for \(key, \w+\) in \[([^\]]+)\]\s*\{\s*check_(?:range|float)\(key, \w+, ([^,]+), ([^)]+)\)/g)) {
        for (const [, key] of m[1].matchAll(/"([a-z_.]+)"/g)) found.set(key, [bound(m[2]), bound(m[3])]);
    }
    return found;
}

test("every number row of the settings window has the daemon's bounds", () => {
    const daemon = daemonBounds();
    assert.ok(daemon.size > 20, `only ${daemon.size} bounds were read from config.rs`);
    const window = new Map<string, [Bound, Bound]>();
    for (const row of allRows()) {
        if (row.kind.type !== 'int' && row.kind.type !== 'float') continue;
        const min: Bound = row.kind.type === 'int' && row.kind.atLeast ? { key: row.kind.atLeast } : row.kind.min;
        window.set(`${row.table}.${row.key}`, [min, row.kind.max]);
    }
    assert.deepEqual(Object.fromEntries(window), Object.fromEntries(daemon));
});
