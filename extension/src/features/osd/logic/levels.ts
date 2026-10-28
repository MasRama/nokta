/** One monitor's entry in GNOME 49's `osdWindowManager.show(icon, label, levels)`. */
export interface OsdLevel {
    level?: number | null;
    maxLevel?: number | null;
}

export interface LevelRequest {
    /** -1 when several monitors are named; routing then picks one. */
    monitorIndex: number;
    level: number | null | undefined;
    maxLevel: number | null | undefined;
}

/**
 * Turns GNOME 49's per-monitor levels into one request. With several
 * monitors the level of `preferred` (the focused one) is shown when it has
 * an entry, else that of the lowest index.
 */
export function fromLevels(
    levels: Readonly<Record<number, OsdLevel | null | undefined>> | null | undefined,
    preferred: number,
): LevelRequest | null {
    const monitors = Object.keys(levels ?? {})
        .map(Number)
        .filter((monitor) => levels?.[monitor])
        .sort((a, b) => a - b);
    if (monitors.length === 0) return null;
    const single = monitors.length === 1;
    const chosen = single || !monitors.includes(preferred) ? monitors[0] : preferred;
    const { level, maxLevel } = levels![chosen]!;
    return { monitorIndex: single ? chosen : -1, level, maxLevel };
}
