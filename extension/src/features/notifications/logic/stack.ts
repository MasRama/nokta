export interface Shown {
    /** The app that sent it (GNOME's source object, or an app's id); compared by identity. */
    source: unknown;
    notification: unknown;
}

export interface Stacked extends Shown {
    count: number;
}

/**
 * How many notifications the notch's one stands for once `next` replaces
 * `previous`, the one showing (null when none shows). A new one from the
 * same source adds one; the same one again, updated, keeps the count;
 * another source starts again at 1.
 */
export function stackCount(previous: Stacked | null, next: Shown): number {
    if (!previous || next.source === null || previous.source !== next.source) return 1;
    return previous.notification === next.notification ? previous.count : previous.count + 1;
}

/** The badge on the icon: nothing for one notification, then 2 to 9, then 9+. */
export const stackBadge = (count: number): string | null => (count < 2 ? null : count > 9 ? '9+' : String(count));
