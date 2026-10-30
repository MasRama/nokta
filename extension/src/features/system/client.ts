import type Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

import { SYSTEM1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { usageFrom, type Usage } from './logic/format.js';

/** io.nokta.System1.MemoryLow: used and total bytes, and the app using the most. */
export type MemoryLowHandler = (used: number, total: number, app: string) => void;

/**
 * io.nokta.System1: the system's use while a page watches it, and the memory
 * alert. The daemon samples only between `watch()` and `unwatch()`.
 */
export class SystemClient {
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;
    private signalId = 0;
    /** How many open pages watch; the daemon is asked once. */
    private watchers = 0;
    private current: Usage | null = null;
    private readonly listeners = new Listeners();

    constructor(private readonly onMemoryLow: MemoryLowHandler) {}

    /** The latest sample, null before the first one. */
    usage(): Usage | null {
        return this.current;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(SYSTEM1_XML, PATHS.System1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.read());
        this.signalId = proxy.connect('g-signal', (_proxy, _sender, name: string, parameters: GLib.Variant) => {
            if (name !== 'MemoryLow') return;
            const [used, total, app] = parameters.deepUnpack() as [number, number, string];
            this.onMemoryLow(used, total, app);
        });
        // A daemon that started again forgot who watched.
        if (this.watchers > 0) callMethod(proxy, 'Watch');
        this.read();
    }

    /** A page opened; sampling starts with the first. */
    watch(): void {
        this.watchers += 1;
        if (this.watchers === 1 && this.proxy) callMethod(this.proxy, 'Watch');
    }

    /** A page closed; sampling stops with the last. */
    unwatch(): void {
        if (this.watchers === 0) return;
        this.watchers -= 1;
        if (this.watchers === 0) {
            if (this.proxy) callMethod(this.proxy, 'Unwatch');
            this.current = null;
            this.listeners.emit();
        }
    }

    /** Forgets the daemon; its watches went with it. */
    detach(): void {
        if (this.changedId) this.proxy?.disconnect(this.changedId);
        if (this.signalId) this.proxy?.disconnect(this.signalId);
        this.changedId = 0;
        this.signalId = 0;
        this.proxy = null;
        this.current = null;
        this.listeners.emit();
    }

    destroy(): void {
        if (this.watchers > 0 && this.proxy) callMethod(this.proxy, 'Unwatch');
        this.watchers = 0;
        this.listeners.clear();
        this.detach();
    }

    private read(): void {
        if (!this.proxy) return;
        this.current = this.watchers > 0 ? usageFrom(cached(this.proxy, 'Usage')) : null;
        this.listeners.emit();
    }
}
