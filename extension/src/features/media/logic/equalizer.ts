export const BAR_COUNT = 4;
/** Bar heights as a fraction of the full bar. */
export const LEVEL_MIN = 0.25;
export const LEVEL_MAX = 1;

/** Per bar: a fast and a slow wave in Hz, and a phase, so bars never sync. */
const WAVES = [
    { fast: 1.7, slow: 0.6, phase: 0.0 },
    { fast: 2.3, slow: 0.9, phase: 1.3 },
    { fast: 1.3, slow: 1.1, phase: 2.6 },
    { fast: 2.9, slow: 0.7, phase: 4.1 },
];

/**
 * Heights of the equalizer bars at `ms`: two sine waves per bar, mapped to
 * LEVEL_MIN..LEVEL_MAX. A playback indicator, not a spectrum.
 */
export function barLevels(ms: number): number[] {
    const t = ms / 1000;
    return WAVES.map(({ fast, slow, phase }) => {
        const wave = Math.sin(2 * Math.PI * fast * t + phase) + Math.sin(2 * Math.PI * slow * t + phase * 0.7);
        return LEVEL_MIN + ((wave + 2) / 4) * (LEVEL_MAX - LEVEL_MIN);
    });
}

/** Levels older than this are gone: noktad sends them 25 times a second, twice a second while silent. */
export const LEVELS_STALE_MS = 1000;
/** Per step, a bar covers this part of the way up to its level, and this part down. */
const RISE = 0.6;
const FALL = 0.25;

/** `levels`, if they came at `atMs` recently enough to show at `nowMs`, with one per bar. */
export function freshLevels(levels: readonly number[] | null, atMs: number, nowMs: number): readonly number[] | null {
    if (!levels || levels.length !== BAR_COUNT || nowMs - atMs >= LEVELS_STALE_MS) return null;
    return levels;
}

/** Bar heights for levels from 0 to 1, from LEVEL_MIN up, so a quiet bar still shows. */
export function barsFrom(levels: readonly number[]): number[] {
    return Array.from({ length: BAR_COUNT }, (_, i) => {
        const level = Math.min(1, Math.max(0, levels[i] ?? 0));
        return LEVEL_MIN + level * (LEVEL_MAX - LEVEL_MIN);
    });
}

/** One step from the bars `shown` towards `target`: quick up, slower down, like a level meter. */
export function easeBars(shown: readonly number[], target: readonly number[]): number[] {
    return target.map((to, i) => {
        const from = shown[i] ?? to;
        return from + (to - from) * (to > from ? RISE : FALL);
    });
}
