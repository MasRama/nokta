/** How the notch changes size: opening, closing, or the width changing while it stays open or closed. */
export type ResizeKind = 'open' | 'close' | 'width';

export interface SpringParams {
    /** About how long one swing takes, in ms. */
    responseMs: number;
    /** 1 settles without overshoot; below 1 overshoots a little. */
    dampingRatio: number;
}

/** A value on its way to a target: px and px per second. */
export interface SpringState {
    value: number;
    velocity: number;
}

const SPRINGS: Record<ResizeKind, SpringParams> = {
    open: { responseMs: 380, dampingRatio: 0.78 },
    close: { responseMs: 260, dampingRatio: 1 },
    width: { responseMs: 300, dampingRatio: 0.9 },
};

/** Integration step: small enough to stay stable at the fastest animation speed. */
const SUBSTEP_MS = 4;
/** A frame longer than this (the shell was busy) moves the spring this far only. */
const MAX_FRAME_MS = 64;
const SETTLED_PX = 0.5;
const SETTLED_PX_PER_S = 5;

/** The spring of a resize; `speed` is the config's animation_speed (2.0 = twice as slow). */
export function springFor(kind: ResizeKind, speed: number): SpringParams {
    const { responseMs, dampingRatio } = SPRINGS[kind];
    return { responseMs: responseMs * speed, dampingRatio };
}

/**
 * Moves the spring `dtMs` towards `target`. The velocity carries over, so a
 * new target mid-way bends the motion instead of restarting it.
 */
export function stepSpring(state: SpringState, target: number, dtMs: number, params: SpringParams): SpringState {
    const omega = (2 * Math.PI) / (params.responseMs / 1000);
    const stiffness = omega * omega;
    const damping = 2 * params.dampingRatio * omega;
    let { value, velocity } = state;
    let left = Math.min(dtMs, MAX_FRAME_MS);
    while (left > 0) {
        const dt = Math.min(SUBSTEP_MS, left) / 1000;
        // Semi-implicit Euler: velocity first, then position with the new velocity.
        velocity += (-stiffness * (value - target) - damping * velocity) * dt;
        value += velocity * dt;
        left -= SUBSTEP_MS;
    }
    return { value, velocity };
}

/** Close enough and slow enough to snap to the target. */
export function settled(state: SpringState, target: number): boolean {
    return Math.abs(state.value - target) < SETTLED_PX && Math.abs(state.velocity) < SETTLED_PX_PER_S;
}

/**
 * The velocity, in px per second, that pushes a spring resting at `width`
 * past it by `fraction` of it before it swings back. The spring is linear,
 * so the peak grows with the kick: one unit kick through stepSpring gives
 * the scale, with the same integration error as the notch's frames.
 */
export function kickVelocity(width: number, params: SpringParams, fraction: number): number {
    let state: SpringState = { value: 0, velocity: 1 };
    while (state.velocity > 0) state = stepSpring(state, 0, SUBSTEP_MS, params);
    return state.value > 0 ? (fraction * width) / state.value : 0;
}
