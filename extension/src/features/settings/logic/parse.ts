/** io.nokta.Settings1.Appearance in camelCase, with the spec defaults. */
export interface Appearance {
    height: number;
    idleWidth: number;
    playingWidth: number;
    expandedWidth: number;
    expandedHeight: number;
    cornerRadius: number;
    earRadius: number;
    background: string;
    foreground: string;
    useAlbumAccent: boolean;
    animationSpeed: number;
    osdWidth: number;
    backgroundOpacity: number;
    accent: string;
}

export interface Behavior {
    openDelayMs: number;
    closeDelayMs: number;
    moveClock: boolean;
    showLyrics: boolean;
    replaceOsd: boolean;
    osdDurationMs: number;
    showCapsLock: boolean;
    allMonitors: boolean;
    deviceAlerts: boolean;
    alertDurationMs: number;
    showClock: boolean;
    /** "system", "24h" or "12h"; anything else counts as "system". */
    clockFormat: string;
}

/** io.nokta.Settings1.Lyrics in camelCase. */
export interface Lyrics {
    enabled: boolean;
}

export const DEFAULT_APPEARANCE: Readonly<Appearance> = {
    height: 32,
    idleWidth: 180,
    playingWidth: 260,
    expandedWidth: 420,
    expandedHeight: 150,
    cornerRadius: 14,
    earRadius: 8,
    background: '#000000',
    foreground: '#ffffff',
    useAlbumAccent: true,
    animationSpeed: 1.0,
    osdWidth: 300,
    backgroundOpacity: 1.0,
    accent: '#ffffff',
};

export const DEFAULT_BEHAVIOR: Readonly<Behavior> = {
    openDelayMs: 120,
    closeDelayMs: 300,
    moveClock: true,
    showLyrics: true,
    replaceOsd: true,
    osdDurationMs: 1500,
    showCapsLock: true,
    allMonitors: true,
    deviceAlerts: true,
    alertDurationMs: 3000,
    showClock: true,
    clockFormat: 'system',
};

export const DEFAULT_LYRICS: Readonly<Lyrics> = {
    enabled: true,
};

const isColor = (value: unknown): boolean => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Reads an a{sv} table from the daemon. Each key that is missing or has the
 * wrong type keeps its default, so an older or newer daemon never breaks the UI.
 */
function fromTable<T extends object>(raw: unknown, defaults: Readonly<T>): T {
    const table = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out = { ...defaults } as Record<string, unknown>;
    for (const [key, fallback] of Object.entries(defaults)) {
        const value = table[snakeCase(key)];
        const valid =
            typeof value === typeof fallback &&
            (typeof value !== 'number' || Number.isFinite(value)) &&
            (typeof value !== 'string' || !isColor(fallback) || isColor(value));
        if (valid) out[key] = value;
    }
    return out as T;
}

export const appearanceFrom = (raw: unknown): Appearance => fromTable(raw, DEFAULT_APPEARANCE);
export const behaviorFrom = (raw: unknown): Behavior => fromTable(raw, DEFAULT_BEHAVIOR);
export const lyricsFrom = (raw: unknown): Lyrics => fromTable(raw, DEFAULT_LYRICS);
