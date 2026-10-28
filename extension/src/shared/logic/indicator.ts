/** What can sit in the closed notch's one spot for extra information. */
export type Indicator = 'call' | 'timer' | 'clock' | 'activity' | 'shelf';

export interface IndicatorInput {
    /** The microphone is on for a call. */
    call: boolean;
    /** A focus timer is set. */
    timer: boolean;
    /** A countdown, stopwatch or alarm wants the spot. */
    clock: boolean;
    /** A live activity runs. */
    activity: boolean;
    /** The shelf has files. */
    shelf: boolean;
}

/**
 * The spot in place of the clock while idle, next to the equalizer while
 * music plays: the focus timer, else a countdown, stopwatch or alarm, else
 * the newest live activity, else the shelf badge. A call comes first: the
 * microphone being on matters more than any of them.
 */
export function chooseIndicator({ call, timer, clock, activity, shelf }: IndicatorInput): Indicator | null {
    if (call) return 'call';
    if (timer) return 'timer';
    if (clock) return 'clock';
    if (activity) return 'activity';
    if (shelf) return 'shelf';
    return null;
}
