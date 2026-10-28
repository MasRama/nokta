import type { Indicator } from './indicator.js';

/** Something running toward its end: `leftUs` of `totalUs` remain now, passing at `rate`. */
export interface Span {
    totalUs: number;
    leftUs: number;
    running: boolean;
    rate: number;
}

export interface LineInput {
    indicator: Indicator | null;
    /** The closed notch shows the song beside its cover. */
    collapsed: boolean;
    /** The focus timer, while one is set. */
    timer: Span | null;
    /** The indicator's clock while it is a countdown; null for a stopwatch or an alarm. */
    clock: Span | null;
    /** The newest activity's progress, 0 to 1, or -1 when unknown. */
    activity: number;
    song: Span | null;
}

export interface Line {
    fraction: number;
    /** How long the line takes to fill from here; null while it stands still. */
    msToEnd: number | null;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

function spanLine({ totalUs, leftUs, running, rate }: Span): Line | null {
    if (totalUs <= 0) return null;
    const msToEnd = running && rate > 0 ? Math.max(0, leftUs) / rate / 1000 : null;
    return { fraction: clamp(1 - leftUs / totalUs), msToEnd };
}

/**
 * The closed notch's progress line: what the indicator shows, if it has a
 * progress, else the song while it plays beside the cover. A recording or a
 * call has none, and hides the song's too.
 */
export function progressLine({ indicator, collapsed, timer, clock, activity, song }: LineInput): Line | null {
    if (indicator === 'recording' || indicator === 'call') return null;
    let line: Line | null = null;
    if (indicator === 'timer' && timer) line = spanLine(timer);
    if (indicator === 'clock' && clock) line = spanLine(clock);
    if (indicator === 'activity' && activity >= 0) line = { fraction: clamp(activity), msToEnd: null };
    if (!line && collapsed && song) line = spanLine(song);
    return line;
}
