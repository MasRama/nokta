const pad = (n: number): string => String(n).padStart(2, '0');

/** `m:ss`, or `h:mm:ss` from one hour. */
export function formatDuration(us: number): string {
    const total = Math.max(0, Math.floor(us / 1_000_000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `HH:MM` in 24-hour time, `h:MM` in 12-hour time (no AM/PM, like the top bar). */
export function formatClock(date: Date, use24h: boolean): string {
    const hours = date.getHours();
    const minutes = pad(date.getMinutes());
    return use24h ? `${pad(hours)}:${minutes}` : `${hours % 12 || 12}:${minutes}`;
}

/**
 * Whether the clock is 24-hour: Nokta's `clock_format`, or GNOME's
 * `clock-format` when it says "system" (or anything unknown).
 */
export function uses24h(clockFormat: string, gnomeClockFormat: string): boolean {
    if (clockFormat === '24h') return true;
    if (clockFormat === '12h') return false;
    return gnomeClockFormat === '24h';
}
