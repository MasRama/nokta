/** What can sit in the closed notch's one spot for extra information. */
export type Indicator = 'timer' | 'activity' | 'shelf';

export interface IndicatorInput {
    /** A focus timer is set. */
    timer: boolean;
    /** A live activity runs. */
    activity: boolean;
    /** The shelf has files. */
    shelf: boolean;
}

/**
 * The spot in place of the clock while idle, next to the equalizer while
 * music plays: the focus timer, else the newest
 * live activity, else the shelf badge.
 */
export function chooseIndicator({ timer, activity, shelf }: IndicatorInput): Indicator | null {
    if (timer) return 'timer';
    if (activity) return 'activity';
    if (shelf) return 'shelf';
    return null;
}
