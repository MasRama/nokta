/** An alert's motions, in ms before animation_speed. Each list ends where the view rests. */

/** The icon rings like a bell: degrees, 120 ms a step. */
export const RING = [14, -12, 9, -6, 0] as const;
export const RING_STEP_MS = 120;

/** The notch shakes sideways: px, 72 ms a step. */
export const SHAKE = [6, -6, 4, -4, 0] as const;
export const SHAKE_STEP_MS = 72;

/** The icon pops: a scale, 200 ms up to the peak, then 120 ms back. */
export const POP = [0.6, 1.12, 1] as const;
export const POP_MS = [200, 120] as const;

/** The icon slides in from `from` px to its place. */
export const SLIDE = { from: -24, ms: 300 } as const;

/** The battery fill grows from empty to its level. */
export const FILL_MS = 500;

/** The battery fill dims to `to` (of 255) and back, once. */
export const SWEEP = { to: 128, ms: 250 } as const;

/** The glow pulses `beats` times. */
export const PULSE = { beats: 3, beatMs: 700 } as const;

/** One step of a motion: ease to `value` over `ms`. */
export interface Step {
    value: number;
    ms: number;
}

/** The steps of `values`, `stepMs` each, scaled by animation_speed. */
export function keyframeSteps(values: readonly number[], stepMs: number, speed: number): Step[] {
    return values.map((value) => ({ value, ms: stepMs * speed }));
}
