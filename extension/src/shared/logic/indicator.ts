/** What can sit in the closed notch's one spot for extra information. */
export type Indicator = 'recording' | 'call' | 'timer' | 'clock' | 'activity' | 'meeting' | 'shelf';

export interface IndicatorInput {
    /** GNOME's screenshot UI records the screen. */
    recording: boolean;
    /** The microphone is on for a call. */
    call: boolean;
    /** A focus timer is set. */
    timer: boolean;
    /** A countdown, stopwatch or alarm wants the spot. */
    clock: boolean;
    /** A live activity runs. */
    activity: boolean;
    /** A calendar event is about to start, or just did. */
    meeting?: boolean;
    /** The shelf has files. */
    shelf: boolean;
}

/**
 * The spot in place of the clock while idle, next to the equalizer while
 * music plays: the focus timer, else a countdown, stopwatch or alarm, else
 * the newest live activity, else a meeting's countdown, else the shelf badge. A screen recording and
 * then a call come first: the screen or the microphone being recorded
 * matters more than any of them.
 */
export function chooseIndicator({ recording, call, timer, clock, activity, meeting, shelf }: IndicatorInput): Indicator | null {
    if (recording) return 'recording';
    if (call) return 'call';
    if (timer) return 'timer';
    if (clock) return 'clock';
    if (activity) return 'activity';
    if (meeting) return 'meeting';
    if (shelf) return 'shelf';
    return null;
}
