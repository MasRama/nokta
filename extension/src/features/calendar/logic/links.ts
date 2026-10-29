/** How long a link the daemon gave stays good before it is asked for again. */
const LINK_KEEP_MS = 10 * 60_000;

/** The event ids to ask the daemon about: never asked, or asked 10 minutes ago or more. */
export function linksToAsk(ids: readonly string[], askedAt: ReadonlyMap<string, number>, nowMs: number): string[] {
    const wanted = new Set<string>();
    for (const id of ids) {
        const at = askedAt.get(id);
        if (at === undefined || nowMs - at >= LINK_KEEP_MS) wanted.add(id);
    }
    return [...wanted];
}
