/** How long the closed notch shows a new song's title. */
export const PEEK_MS = 3000;

/** What the peek needs to know of the song playing. */
export interface PeekTrack {
    /** Tells one song from the next. */
    key: string;
    title: string;
    playing: boolean;
}

/** Where the notch is: `drawn` is the view it draws. */
export interface PeekState {
    /** `[behavior] track_peek`. */
    enabled: boolean;
    drawn: string;
    /** A fullscreen app hides the notch. */
    fullscreen: boolean;
}

/** The views a peek may replace: the closed notch, or a peek already showing. */
const CLOSED = ['idle', 'collapsed', 'peek'];

/**
 * Whether the song changing from `prev` to `next` peeks: a new song that
 * plays and has a title, while the notch is closed and on screen. Not on the
 * first snapshot (`prev` null), so enabling Nokta does not peek.
 */
export function shouldPeek(prev: PeekTrack | null, next: PeekTrack, state: PeekState): boolean {
    if (!state.enabled || state.fullscreen || !prev) return false;
    if (!CLOSED.includes(state.drawn)) return false;
    return next.key !== prev.key && next.playing && next.title !== '';
}
