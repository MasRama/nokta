import { TONES } from '../../../shared/logic/tones.js';

/** The battery's fill: red when nearly out, amber when low, green otherwise. */
export function batteryTone(level: number): string {
    if (level <= 10) return TONES.urgent;
    if (level <= 20) return TONES.countdown;
    return TONES.success;
}

/** The fill's width inside a battery `inner` px wide; a sliver stays while any charge is left. */
export function batteryFill(level: number, inner: number): number {
    if (level <= 0) return 0;
    return Math.max(1, Math.round((inner * Math.min(level, 100)) / 100));
}
