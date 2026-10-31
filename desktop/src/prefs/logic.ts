import {
    SETTINGS_PAGES,
    type Group,
    type Page,
    type Row,
    type RowKind,
} from '@ext/features/settings/logic/schema.js';
import { N_ } from '@ext/shared/logic/i18n.js';

/** A row of the Windows window: the extension's kinds, and the calendar feeds. */
export type PrefKind = RowKind | { type: 'feeds'; max: number };

export interface PrefRow extends Omit<Row, 'kind'> {
    kind: PrefKind;
}

export interface PrefGroup extends Omit<Group, 'rows'> {
    rows: PrefRow[];
}

export interface PrefPage extends Omit<Page, 'groups'> {
    groups: PrefGroup[];
}

/** As the core's `MAX_FEEDS`. */
export const MAX_FEEDS = 5;

const nameOf = (row: Pick<Row, 'table' | 'key'>) => `${row.table}.${row.key}`;

/** Settings Windows has no use for: GNOME's top bar, gestures, and what only GNOME reports. */
const HIDDEN = new Set([
    'behavior.move_clock',
    'behavior.all_monitors',
    'behavior.gestures',
    'timer.quiet_notifications',
    'activities.auto_progress',
]);

/** Subtitles that name GNOME, as they read on Windows; empty for none. */
const SUBTITLES: Record<string, string> = {
    'appearance.height': N_('Pixels'),
    'behavior.replace_osd': '',
    'notifications.in_notch': N_("Windows' own banners stay until you turn them off for each app"),
    'behavior.screenshot_preview': N_('Open a new screenshot, show it in Explorer or keep it on the shelf'),
    'downloads.enabled': N_('Open the file, show it in Explorer or keep it on the shelf'),
    'calendar.enabled': N_('From the calendars below, when the notch opens'),
    'media.real_equalizer': N_('Measures what plays, on this computer only'),
    'timer.focus_minutes': N_("Minutes; start it from home's Focus tile"),
};

/** Choices whose label names GNOME. */
const LABELS: Record<string, Record<string, string>> = {
    'behavior.clock_format': { system: N_('Follow Windows') },
};

/** Choices Windows has: no Do Not Disturb or Night Light to switch. */
const ONLY: Record<string, readonly string[]> = {
    'home.toggles': ['caffeine', 'dark_style'],
};

/** The calendar feeds, after the calendar's own rows. */
export const FEEDS_ROW: PrefRow = {
    table: 'calendar',
    key: 'feeds',
    title: N_('Calendars'),
    subtitle: N_('The secret iCal address of a Google, Outlook or iCloud calendar'),
    kind: { type: 'feeds', max: MAX_FEEDS },
};

function windowsRow(row: Row): PrefRow {
    const name = nameOf(row);
    let kind: PrefKind = row.kind;
    if (kind.type === 'choice' && LABELS[name]) {
        const labels = LABELS[name];
        kind = { ...kind, options: kind.options.map((o) => ({ ...o, label: labels[o.value] ?? o.label })) };
    }
    if (kind.type === 'order' && ONLY[name]) {
        const only = ONLY[name];
        kind = { ...kind, options: kind.options.filter((o) => only.includes(o.value)) };
    }
    const subtitle = name in SUBTITLES ? SUBTITLES[name] || undefined : row.subtitle;
    return { ...row, subtitle, kind };
}

/** The extension's pages as Windows shows them. */
export function windowsPages(pages: readonly Page[] = SETTINGS_PAGES): PrefPage[] {
    return pages.map((page) => ({
        ...page,
        groups: page.groups.map((group) => {
            const rows = group.rows.filter((row) => !HIDDEN.has(nameOf(row))).map(windowsRow);
            if (rows.some((row) => nameOf(row) === 'calendar.enabled')) rows.push(FEEDS_ROW);
            return { ...group, rows };
        }),
    }));
}

/** A feed as the window lists it: the host only, since the address is a secret. */
export function feedLabel(feed: string): string {
    try {
        return new URL(feed.trim().replace(/^webcal:/i, 'https:')).hostname || feed;
    } catch {
        return feed;
    }
}

/** Whether `feed` is an address the core takes: https:// or webcal://, with a host. */
export function isFeed(feed: string): boolean {
    const text = feed.trim();
    if (!/^(https|webcal):\/\//i.test(text)) return false;
    try {
        return new URL(text.replace(/^webcal:/i, 'https:')).hostname !== '';
    } catch {
        return false;
    }
}
