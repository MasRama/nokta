import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { SHELF1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { itemsFrom, type ShelfItem } from './logic/items.js';

/** io.nokta.Shelf1: the files parked on the notch. The shell and the helper window both use it. */
export class ShelfClient {
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;
    private current: ShelfItem[] = [];
    private readonly listeners = new Listeners();

    /** Oldest first. */
    items(): readonly ShelfItem[] {
        return this.current;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(SHELF1_XML, PATHS.Shelf1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.read());
        this.read();
    }

    add(uris: readonly string[]): void {
        if (this.proxy && uris.length > 0) callMethod(this.proxy, 'Add', new GLib.Variant('(as)', [uris]));
    }

    remove(uri: string): void {
        if (this.proxy) callMethod(this.proxy, 'Remove', new GLib.Variant('(s)', [uri]));
    }

    clear(): void {
        if (this.proxy) callMethod(this.proxy, 'Clear');
    }

    /** Forgets the daemon; the shelf shows empty. */
    detach(): void {
        if (this.changedId) this.proxy?.disconnect(this.changedId);
        this.changedId = 0;
        this.proxy = null;
        this.current = [];
        this.listeners.emit();
    }

    destroy(): void {
        this.listeners.clear();
        this.detach();
    }

    private read(): void {
        const proxy = this.proxy;
        if (!proxy) return;
        this.current = itemsFrom(cached(proxy, 'Items'), cached(proxy, 'Thumbnails'));
        this.listeners.emit();
    }
}
