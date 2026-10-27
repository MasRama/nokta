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
