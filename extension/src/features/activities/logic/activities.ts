/** One running activity from io.nokta.Activities1. */
export interface Activity {
    id: string;
    title: string;
    detail: string;
    /** An icon name; empty for the default. */
    icon: string;
    /** 0 to 1, or -1 when unknown. */
    progress: number;
    /** CLOCK_MONOTONIC in µs, like GLib.get_monotonic_time(). */
    startedUs: number;
}

/** What the notch shows when an activity ends. */
export interface EndedAlert {
    icon: string;
    title: string;
    detail: string;
    /** Shown in red. */
    urgent: boolean;
}

const DEFAULT_ICON = 'emblem-synchronizing-symbolic';

const isRow = (row: unknown): row is [string, string, string, string, number, number] =>
    Array.isArray(row) &&
    row.length === 6 &&
    row.slice(0, 4).every((v) => typeof v === 'string') &&
    row.slice(4).every((v) => typeof v === 'number' && Number.isFinite(v));

/** The `Activities` property, newest first; rows of the wrong shape are left out. */
export function activitiesFrom(raw: unknown): Activity[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isRow).map(([id, title, detail, icon, progress, startedUs]) => ({
        id,
        title,
        detail,
        icon,
        progress,
        startedUs,
    }));
}

export const activityIcon = (icon: string): string => icon || DEFAULT_ICON;

/** `40%`, or null while the progress is unknown. */
export function progressLabel(progress: number): string | null {
    if (progress < 0) return null;
    return `${Math.floor(Math.min(progress, 1) * 100)}%`;
}

/** `12 s`, `1 min 32 s`, `1 h 5 min`. */
export function formatElapsed(us: number): string {
    const seconds = Math.max(0, Math.floor(us / 1_000_000));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
    if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`;
    return `${s} s`;
}

/** The alert for an `Ended` signal: the message, or how long it took. */
export function endedAlert(title: string, success: boolean, message: string, elapsedUs: number): EndedAlert {
    const elapsed = formatElapsed(elapsedUs);
    return {
        icon: success ? 'object-select-symbolic' : 'dialog-error-symbolic',
        title,
        detail: message || (success ? `Done in ${elapsed}` : `Failed after ${elapsed}`),
        urgent: !success,
    };
}
