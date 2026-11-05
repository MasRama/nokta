import { _, format, ngettext } from '../../../shared/logic/i18n.js';

/** How many notifications one app sent. */
export interface Missed {
    app: string;
    count: number;
}

/** Apps the digest names; the others are counted together. */
const NAMED = 2;

/** `apps` (one entry per notification) counted by app, most first, then by name. */
export function tally(apps: readonly string[]): Missed[] {
    const counts = new Map<string, number>();
    for (const app of apps) counts.set(app, (counts.get(app) ?? 0) + 1);
    return [...counts]
        .map(([app, count]) => ({ app, count }))
        .sort((a, b) => b.count - a.count || a.app.localeCompare(b.app));
}

/**
 * The alert after a focus session for the notifications that came during
 * it, one app name per notification; null when none came. It names the two
 * apps that sent the most and counts the rest, to fit an alert.
 */
export function digestLines(apps: readonly string[]): { title: string; detail: string } | null {
    if (apps.length === 0) return null;
    const missed = tally(apps.map((app) => app.trim() || _('Other apps')));
    const title = format(
        ngettext('%d notification while you focused', '%d notifications while you focused', apps.length),
        apps.length,
    );
    if (missed.length === 1) {
        const [only] = missed as [Missed];
        return { title, detail: only.count === 1 ? only.app : `${only.app} ${only.count}` };
    }
    const named = missed.slice(0, NAMED).map(({ app, count }) => `${app} ${count}`);
    const rest = missed.slice(NAMED).reduce((sum, m) => sum + m.count, 0);
    if (rest > 0) named.push(format(ngettext('%d more', '%d more', rest), rest));
    return { title, detail: named.join(' · ') };
}

/**
 * The app of each notification in `now` that was not there `before`: on
 * GNOME, those that reached the message list during focus and are still
 * there, unread.
 */
export function arrivedSince<T>(before: ReadonlySet<T>, now: ReadonlyArray<{ item: T; app: string }>): string[] {
    return now.filter(({ item }) => !before.has(item)).map(({ app }) => app);
}

/**
 * Follows focus keeping notifications quiet: says when it starts and ends,
 * and counts what came in between (for Windows, where the notch hears each
 * notification itself).
 */
export class FocusDigest {
    private on = false;
    private apps: string[] = [];

    get quiet(): boolean {
        return this.on;
    }

    update(quiet: boolean): 'start' | 'end' | 'none' {
        if (quiet === this.on) return 'none';
        this.on = quiet;
        if (quiet) this.apps = [];
        return quiet ? 'start' : 'end';
    }

    /** A notification came; counted only while quiet. */
    add(app: string): void {
        if (this.on) this.apps.push(app);
    }

    /** What was counted, once. */
    take(): string[] {
        const apps = this.apps;
        this.apps = [];
        return apps;
    }
}
