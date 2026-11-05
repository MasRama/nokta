/**
 * Add-on plugins as io.nokta.Plugins1 publishes them: the installed ones
 * with their options, and the cards of the ones that run.
 */

import { _, format } from '../../../shared/logic/i18n.js';

/** A plugin's own icon when it names none. */
export const PLUGIN_ICON = 'nokta-plugin';

/** The tones a card may name, as colors on the dark notch. */
export const PLUGIN_TONES: Readonly<Record<string, string>> = {
    red: '#ff453a',
    orange: '#ff9f0a',
    amber: '#ffb340',
    yellow: '#ffd60a',
    green: '#30d158',
    teal: '#40c8e0',
    blue: '#0a84ff',
    indigo: '#5e5ce6',
    purple: '#bf5af2',
    pink: '#ff375f',
    gray: '#a2a2ab',
};

/** A card without a tone. */
export const DEFAULT_TONE = 'purple';

export type OptionType = 'text' | 'bool' | 'int' | 'choice';

export interface PluginOption {
    key: string;
    title: string;
    subtitle: string;
    type: OptionType;
    value: string | number | boolean;
    min: number;
    max: number;
    choices: string[];
}

/** What a plugin is doing: `off`, `running` (nothing printed yet), `ok`, `error`, `broken` or `unsupported`. */
export type PluginStatus = 'off' | 'running' | 'ok' | 'error' | 'broken' | 'unsupported';

/** One installed plugin. */
export interface Plugin {
    id: string;
    enabled: boolean;
    status: PluginStatus;
    /** Why it failed or is broken; empty otherwise. */
    message: string;
    name: string;
    description: string;
    version: string;
    author: string;
    homepage: string;
    icon: string;
    /** Its folder. */
    dir: string;
    /** Seconds between runs; 0 for a plugin that keeps running. */
    every: number;
    /** It has a command for this system. */
    runsHere: boolean;
    options: PluginOption[];
}

export interface PluginItem {
    title: string;
    detail: string;
    icon: string;
    /** An http(s) address, or empty. */
    open: string;
}

export interface PluginAction {
    label: string;
    /** An http(s) address to open, or empty. */
    open: string;
    /** What to tell the plugin, or empty. */
    run: string;
}

/** What a running plugin shows. */
export interface PluginCard {
    id: string;
    /** The plugin's name, for a sub-page's header. */
    name: string;
    title: string;
    detail: string;
    /** Its own icon, else the plugin's, else Nokta's plugin icon. */
    icon: string;
    /** A `#rrggbb` color. */
    color: string;
    /** 0 to 1, or null for none. */
    progress: number | null;
    /** A few characters for the closed notch; empty for none. */
    badge: string;
    items: PluginItem[];
    actions: PluginAction[];
}

/** A plugin's alert, from the Alert signal. */
export interface PluginAlert {
    title: string;
    detail: string;
    icon: string;
    color: string;
    important: boolean;
}

const STATUSES: readonly PluginStatus[] = ['off', 'running', 'ok', 'error', 'broken', 'unsupported'];
const TYPES: readonly OptionType[] = ['text', 'bool', 'int', 'choice'];

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (map: Record<string, unknown>, key: string): string => {
    const value = map[key];
    return typeof value === 'string' ? value : '';
};
const number = (map: Record<string, unknown>, key: string, fallback: number): number => {
    const value = map[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

function parseJson(raw: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(raw);
        return isObject(value) ? value : null;
    } catch {
        return null;
    }
}

/** The color for a card's `tone`; an unknown or empty one is the default. */
export function toneColor(tone: string): string {
    return PLUGIN_TONES[tone] ?? PLUGIN_TONES[DEFAULT_TONE];
}

function optionFrom(raw: unknown): PluginOption | null {
    if (!isObject(raw)) return null;
    const type = raw.type as OptionType;
    const key = text(raw, 'key');
    if (!key || !TYPES.includes(type)) return null;
    const value = raw.value;
    const fits =
        (type === 'bool' && typeof value === 'boolean') ||
        (type === 'int' && typeof value === 'number') ||
        ((type === 'text' || type === 'choice') && typeof value === 'string');
    if (!fits) return null;
    return {
        key,
        title: text(raw, 'title') || key,
        subtitle: text(raw, 'subtitle'),
        type,
        value: value as string | number | boolean,
        min: number(raw, 'min', 0),
        max: number(raw, 'max', 0),
        choices: Array.isArray(raw.choices) ? raw.choices.filter((c): c is string => typeof c === 'string') : [],
    };
}

/** The `Plugins` property; rows of the wrong shape are left out. */
export function pluginsFrom(raw: unknown): Plugin[] {
    if (!Array.isArray(raw)) return [];
    const plugins: Plugin[] = [];
    for (const row of raw) {
        if (!Array.isArray(row) || row.length !== 5) continue;
        const [id, enabled, status, message, infoText] = row as unknown[];
        if (typeof id !== 'string' || typeof enabled !== 'boolean' || typeof message !== 'string') continue;
        if (typeof infoText !== 'string' || !STATUSES.includes(status as PluginStatus)) continue;
        const info = parseJson(infoText) ?? {};
        const options = Array.isArray(info.options) ? info.options.map(optionFrom) : [];
        plugins.push({
            id,
            enabled,
            status: status as PluginStatus,
            message,
            name: text(info, 'name') || id,
            description: text(info, 'description'),
            version: text(info, 'version'),
            author: text(info, 'author'),
            homepage: text(info, 'homepage'),
            icon: text(info, 'icon'),
            dir: text(info, 'dir'),
            every: number(info, 'every', 0),
            runsHere: info.runs_here === true,
            options: options.filter((o): o is PluginOption => o !== null),
        });
    }
    return plugins;
}

function itemFrom(raw: unknown): PluginItem | null {
    if (!isObject(raw)) return null;
    const title = text(raw, 'title');
    return title ? { title, detail: text(raw, 'detail'), icon: text(raw, 'icon'), open: text(raw, 'open') } : null;
}

function actionFrom(raw: unknown): PluginAction | null {
    if (!isObject(raw)) return null;
    const label = text(raw, 'label');
    const open = text(raw, 'open');
    const run = text(raw, 'run');
    return label && (open || run) ? { label, open, run } : null;
}

/** The `Cards` property, with each plugin's name and icon from `plugins`. */
export function cardsFrom(raw: unknown, plugins: readonly Plugin[]): PluginCard[] {
    if (!Array.isArray(raw)) return [];
    const cards: PluginCard[] = [];
    for (const row of raw) {
        if (!Array.isArray(row) || row.length !== 2) continue;
        const [id, json] = row as unknown[];
        if (typeof id !== 'string' || typeof json !== 'string') continue;
        const card = parseJson(json);
        if (!card) continue;
        const plugin = plugins.find((p) => p.id === id);
        const progress = card.progress;
        cards.push({
            id,
            name: plugin?.name ?? id,
            title: text(card, 'title'),
            detail: text(card, 'detail'),
            icon: text(card, 'icon') || plugin?.icon || PLUGIN_ICON,
            color: toneColor(text(card, 'tone')),
            progress: typeof progress === 'number' ? Math.min(Math.max(progress, 0), 1) : null,
            badge: text(card, 'badge'),
            items: Array.isArray(card.items)
                ? card.items.map(itemFrom).filter((i): i is PluginItem => i !== null)
                : [],
            actions: Array.isArray(card.actions)
                ? card.actions.map(actionFrom).filter((a): a is PluginAction => a !== null)
                : [],
        });
    }
    return cards;
}

/** The cards home lists: the ones with a title. */
export const homeCards = (cards: readonly PluginCard[]): PluginCard[] => cards.filter((c) => c.title !== '');

/** The card whose badge shows in the closed notch: the first with one. */
export const badgeCard = (cards: readonly PluginCard[]): PluginCard | null => cards.find((c) => c.badge !== '') ?? null;

/** An Alert signal's arguments, with the plugin's icon when it names none. */
export function pluginAlert(
    title: string,
    detail: string,
    icon: string,
    tone: string,
    important: boolean,
    plugin: Plugin | undefined,
): PluginAlert {
    return {
        title,
        detail,
        icon: icon || plugin?.icon || PLUGIN_ICON,
        color: important && !tone ? PLUGIN_TONES.red : toneColor(tone),
        important,
    };
}

/** An option's value as SetOption takes it. */
export function optionText(value: string | number | boolean): string {
    return typeof value === 'number' ? String(Math.round(value)) : String(value);
}

/** What the settings window says under a plugin's name. */
export function statusText(plugin: Plugin): string {
    switch (plugin.status) {
        case 'unsupported':
            return _('Does not run on this system');
        case 'broken':
            return format(_('Cannot load: %s'), plugin.message);
        case 'error':
            return format(_('Failed: %s'), plugin.message);
        case 'running':
            return _('Starting…');
        case 'ok':
            return plugin.description || _('Running');
        default:
            return plugin.description || _('Off');
    }
}

/** One plugin of the catalog, as `Plugins1.Catalog` lists it. */
export interface CatalogPlugin {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    homepage: string;
    icon: string;
    /** It has a command for this system. */
    runsHere: boolean;
}

/** What a catalog plugin's button does: install it, nothing (it is in), update it, or nothing (not here). */
export type CatalogState = 'install' | 'installed' | 'update' | 'unsupported';

/** The JSON `Plugins1.Catalog` answers; entries of the wrong shape are left out. */
export function catalogFrom(json: string): CatalogPlugin[] {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter(isObject).flatMap((entry) => {
        const id = text(entry, 'id');
        const name = text(entry, 'name');
        if (!id || !name) return [];
        return [{
            id,
            name,
            description: text(entry, 'description'),
            version: text(entry, 'version'),
            author: text(entry, 'author'),
            homepage: text(entry, 'homepage'),
            icon: text(entry, 'icon'),
            runsHere: entry.runs_here === true,
        }];
    });
}

/**
 * Whether `available` is a newer version than `installed`: dotted numbers
 * compared one by one, anything after them ignored (as `nokta plugin catalog`).
 */
export function newerVersion(installed: string, available: string): boolean {
    const numbers = (version: string) =>
        version.replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
    const [a, b] = [numbers(installed), numbers(available)];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const [x, y] = [a[i] ?? 0, b[i] ?? 0];
        if (x !== y) return y > x;
    }
    return false;
}

/** What a catalog plugin's row offers, given the installed plugins. */
export function catalogState(listing: CatalogPlugin, installed: readonly Plugin[]): CatalogState {
    const have = installed.find((p) => p.id === listing.id);
    if (have) return newerVersion(have.version, listing.version) ? 'update' : 'installed';
    return listing.runsHere ? 'install' : 'unsupported';
}

/** The catalog's address, for its rows' link and the empty state. */
export const CATALOG_URL = 'https://github.com/MasRama/nokta-plugins';
