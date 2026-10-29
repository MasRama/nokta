/** A toggle's icon turning on grows to `peak` and settles back, in ms before animation_speed. */
export const POP = { from: 1, peak: 1.18, upMs: 110, downMs: 150 } as const;

/** A tile's square under the pointer rises `y` px and grows to `scale`. */
export const LIFT = { y: -2, scale: 1.05, ms: 150 } as const;

/** Whether a toggle going from `was` to `now` pops its icon: only when it turns on. */
export function popsOn(was: boolean, now: boolean): boolean {
    return !was && now;
}
