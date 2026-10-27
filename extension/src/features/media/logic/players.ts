/** A player from io.nokta.Media1's `Players`: (id, display name). */
export type PlayerEntry = [string, string];

export type ScrollDirection = 'up' | 'down' | 'left' | 'right' | 'smooth';

/** Shortest time between two player switches by scrolling, in ms. */
export const SCROLL_PAUSE_MS = 250;

/** Display names; a name that repeats gets a number from its second use on. */
export function playerLabels(players: readonly PlayerEntry[]): string[] {
    const seen = new Map<string, number>();
    return players.map(([, name]) => {
        const base = name || 'Player';
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        return count > 1 ? `${base} ${count}` : base;
    });
}

/**
 * The id of the player `step` places from `activeId`, wrapping around; null
 * with fewer than two players or when `activeId` is not in the list.
 */
export function neighbour(players: readonly PlayerEntry[], activeId: string, step: 1 | -1): string | null {
    const index = players.findIndex(([id]) => id === activeId);
    if (players.length < 2 || index < 0) return null;
    return players[(index + step + players.length) % players.length][0];
}

/**
 * Which way a scroll over the cover switches players: 1 next, -1 previous,
 * 0 none. Only wheel clicks count, at most one per SCROLL_PAUSE_MS, so a
 * touchpad's smooth scrolling cannot race through the list.
 */
export function scrollStep(direction: ScrollDirection, nowMs: number, lastSwitchMs: number): 0 | 1 | -1 {
    if (direction === 'smooth' || nowMs - lastSwitchMs < SCROLL_PAUSE_MS) return 0;
    return direction === 'down' || direction === 'right' ? 1 : -1;
}
