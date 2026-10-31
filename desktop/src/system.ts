import { usageFrom, type Usage } from '@ext/features/system/logic/format.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** `System1.MemoryLow`: used and total bytes, and the app using the most. */
export type MemoryLowHandler = (used: number, total: number, app: string) => void;

/**
 * System1: the system's use while this window's page watches it, and the
 * memory alert, the page's SystemClient. The core counts the watches of
 * each window; one page watches at most once.
 */
export class System extends Follower {
    /** The latest sample, null before the first or while nobody watches. */
    usage: Usage | null = null;
    private watching = false;
    private stopLow: (() => void) | null = null;

    constructor(
        bridge: Bridge,
        onChanged: () => void,
        private readonly onMemoryLow: MemoryLowHandler,
    ) {
        super(bridge, 'System1', onChanged);
    }

    override async attach(): Promise<void> {
        const number = (value: unknown): number => (typeof value === 'number' ? value : 0);
        this.stopLow = this.bridge.onSignal('System1', 'MemoryLow', (used, total, app) =>
            this.onMemoryLow(number(used), number(total), typeof app === 'string' ? app : ''),
        );
        await super.attach();
    }

    override detach(): void {
        this.unwatch();
        this.stopLow?.();
        this.stopLow = null;
        super.detach();
    }

    /** The page opened: the core starts sampling. */
    watch(): void {
        if (this.watching) return;
        this.watching = true;
        this.call('Watch');
        this.read();
    }

    /** The page closed: the core stops sampling. */
    unwatch(): void {
        if (!this.watching) return;
        this.watching = false;
        this.call('Unwatch');
        this.usage = null;
    }

    protected override read(): void {
        // JSON has no NaN: an unknown temperature comes as null.
        const raw = this.props.Usage;
        const usage = Array.isArray(raw) ? raw.map((value: unknown) => (value === null ? NaN : value)) : raw;
        this.usage = this.watching ? usageFrom(usage) : null;
    }
}
