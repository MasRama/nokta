import Clutter from 'gi://Clutter';

export type ResizeKind = 'open' | 'close' | 'width';

const BASE_MS: Record<ResizeKind, number> = { open: 380, close: 240, width: 300 };

const MODES: Record<ResizeKind, Clutter.AnimationMode> = {
    open: Clutter.AnimationMode.EASE_OUT_BACK,
    close: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
    width: Clutter.AnimationMode.EASE_OUT_QUAD,
};

/**
 * Duration of a resize in ms; `speed` is the config's animation_speed
 * (2.0 = twice as slow). The shell's ease() already makes it instant when
 * GNOME animations are turned off.
 */
export function durationFor(kind: ResizeKind, speed: number): number {
    return Math.round(BASE_MS[kind] * speed);
}

export function modeFor(kind: ResizeKind): Clutter.AnimationMode {
    return MODES[kind];
}
