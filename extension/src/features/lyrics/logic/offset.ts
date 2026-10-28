/** One click of the lyrics view's − or + button. */
export const OFFSET_STEP_MS = 250;
/** The daemon keeps the offset within this either way. */
const MAX_OFFSET_MS = 30_000;

/** The offset after one click; positive shows the lyrics earlier. */
export function stepOffset(offsetMs: number, direction: 1 | -1): number {
    return Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, offsetMs + direction * OFFSET_STEP_MS));
}

/** `On time`, `0.5 s earlier` or `0.25 s later`, in hundredths of a second. */
export function offsetLabel(offsetMs: number): string {
    const seconds = Math.round(Math.abs(offsetMs) / 10) / 100;
    if (seconds === 0) return 'On time';
    return `${seconds} s ${offsetMs > 0 ? 'earlier' : 'later'}`;
}
