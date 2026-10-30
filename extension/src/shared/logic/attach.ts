/** A client that could not attach, and why. */
export interface AttachFailure {
    name: string;
    error: unknown;
}

/**
 * Attaches every client at once and waits for all of them. One that fails
 * does not keep the others from working; the failures come back by name.
 */
export async function attachAll(clients: Record<string, () => Promise<void>>): Promise<AttachFailure[]> {
    const names = Object.keys(clients);
    const results = await Promise.allSettled(names.map((name) => clients[name]()));
    return results.flatMap((result, i) => (result.status === 'rejected' ? [{ name: names[i], error: result.reason }] : []));
}
