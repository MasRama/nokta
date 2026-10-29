/** A button in the notch shrinks to this while pressed. */
export const PRESS_SCALE = 0.92;
/** How long it springs back after the press, in ms before animation_speed. */
export const RELEASE_MS = 220;
/** How long it takes to shrink, in ms before animation_speed. */
export const PRESS_MS = 80;

/**
 * The button a press goes to: `chain` says, from the actor under the
 * pointer up to the notch, whether each is a button. -1 when none is.
 */
export function pressTarget(chain: readonly boolean[]): number {
    return chain.indexOf(true);
}

/** Whether the button stays pressed after `event`. */
export function pressState(event: 'press' | 'release' | 'leave' | 'close'): boolean {
    return event === 'press';
}
