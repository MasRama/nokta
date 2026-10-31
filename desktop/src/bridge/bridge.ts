/**
 * The page's link to the core: each interface's properties, their changes,
 * its methods and its signals, under their names in contracts/*.xml (the
 * interface without `io.nokta.`, as `Settings1`). The Windows app answers in
 * the app; the mock answers in a plain browser.
 */

export type Props = Record<string, unknown>;

export interface Bridge {
    /** The interface's properties as they are now. */
    props(iface: string): Promise<Props>;
    /** Calls `cb` with the properties that changed; returns the unsubscribe. */
    onChanged(iface: string, cb: (changed: Props) => void): () => void;
    call(iface: string, method: string, ...args: unknown[]): Promise<unknown>;
    /** Calls `cb` with a signal's arguments; returns the unsubscribe. */
    onSignal(iface: string, signal: string, cb: (...args: unknown[]) => void): () => void;
}

/** Subscribers kept by key, for a bridge's own dispatch. */
export class Listeners<T extends unknown[]> {
    private readonly byKey = new Map<string, Set<(...args: T) => void>>();

    add(key: string, cb: (...args: T) => void): () => void {
        let set = this.byKey.get(key);
        if (!set) this.byKey.set(key, (set = new Set()));
        set.add(cb);
        return () => set.delete(cb);
    }

    emit(key: string, ...args: T): void {
        for (const cb of [...(this.byKey.get(key) ?? [])]) cb(...args);
    }
}
