import { Listeners, type Bridge, type Props } from './bridge.js';

/**
 * The bridge in a plain browser: properties held in memory, set by a scene
 * or a test. `Settings1.Set` changes its table, as the core would.
 */
export class MockBridge implements Bridge {
    readonly calls: Array<{ iface: string; method: string; args: unknown[] }> = [];
    private readonly state = new Map<string, Props>();
    private readonly changed = new Listeners<[Props]>();
    private readonly signals = new Listeners<unknown[]>();

    constructor(initial: Record<string, Props> = {}) {
        for (const [iface, props] of Object.entries(initial)) this.state.set(iface, { ...props });
    }

    /** Changes properties and tells the subscribers. */
    set(iface: string, props: Props): void {
        this.state.set(iface, { ...this.state.get(iface), ...props });
        this.changed.emit(iface, props);
    }

    /** Sends a signal to the subscribers. */
    signal(iface: string, signal: string, ...args: unknown[]): void {
        this.signals.emit(`${iface}.${signal}`, ...args);
    }

    props(iface: string): Promise<Props> {
        return Promise.resolve({ ...this.state.get(iface) });
    }

    onChanged(iface: string, cb: (changed: Props) => void): () => void {
        return this.changed.add(iface, cb);
    }

    call(iface: string, method: string, ...args: unknown[]): Promise<unknown> {
        this.calls.push({ iface, method, args });
        if (iface === 'Settings1' && method === 'Set') {
            const [table, key, value] = args as [string, string, unknown];
            const name = table.charAt(0).toUpperCase() + table.slice(1);
            const current = (this.state.get(iface)?.[name] ?? {}) as Props;
            this.set(iface, { [name]: { ...current, [key]: value } });
        }
        return Promise.resolve(null);
    }

    onSignal(iface: string, signal: string, cb: (...args: unknown[]) => void): () => void {
        return this.signals.add(`${iface}.${signal}`, cb);
    }
}
